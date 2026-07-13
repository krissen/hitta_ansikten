import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { APIClient, NetworkError } from '../src/renderer/shared/api-client.js';

// Build an AbortError the way fetch would surface one.
function makeAbortError() {
  const err = new Error('The operation was aborted');
  err.name = 'AbortError';
  return err;
}

// A fetch mock that never resolves on its own; it rejects with an AbortError
// only when the passed AbortSignal fires (or is already aborted). This lets us
// exercise both the timeout path and the external-signal path deterministically.
function hangingFetch() {
  return vi.fn((_url, opts = {}) => new Promise((_resolve, reject) => {
    const signal = opts.signal;
    if (signal?.aborted) {
      reject(makeAbortError());
      return;
    }
    signal?.addEventListener('abort', () => reject(makeAbortError()), { once: true });
  }));
}

// A fetch mock that resolves immediately with an ok JSON response.
function okFetch(json = {}) {
  return vi.fn(() => Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(json)
  }));
}

// A fetch mock that resolves with a non-ok HTTP response.
function httpErrorFetch(status = 500, statusText = 'Internal Server Error') {
  return vi.fn(() => Promise.resolve({
    ok: false,
    status,
    statusText,
    json: () => Promise.resolve({})
  }));
}

describe('APIClient._fetchWithTimeout', () => {
  let client;
  const originalFetch = global.fetch;

  beforeEach(() => {
    // Fresh instance with a fake base URL — no backend required.
    client = new APIClient('http://127.0.0.1:9999');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('aborts the request when the timeout elapses (classified as timeout)', async () => {
    client._requestTimeout = 10;
    global.fetch = hangingFetch();

    const err = await client.get('/api/v1/anything').catch(e => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.isTimeout).toBe(true);
    expect(err.retryable).toBe(true);
  });

  it('propagates an external signal abort to the request', async () => {
    client._requestTimeout = 60000; // ensure the timeout does not fire first
    global.fetch = hangingFetch();

    const ext = new AbortController();
    const p = client.post('/api/v1/anything', {}, { signal: ext.signal });
    ext.abort();

    const err = await p.catch(e => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.isTimeout).toBe(true);
  });

  it('removes the abort listener from the external signal after a successful settle', async () => {
    global.fetch = okFetch({ ok: true });

    const ext = new AbortController();
    const addSpy = vi.spyOn(ext.signal, 'addEventListener');
    const removeSpy = vi.spyOn(ext.signal, 'removeEventListener');

    await client.post('/api/v1/anything', {}, { signal: ext.signal });

    expect(addSpy).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('does not accumulate listeners across repeated calls with a long-lived signal', async () => {
    global.fetch = okFetch({ ok: true });

    const ext = new AbortController();
    const addSpy = vi.spyOn(ext.signal, 'addEventListener');
    const removeSpy = vi.spyOn(ext.signal, 'removeEventListener');

    for (let i = 0; i < 5; i++) {
      await client.post('/api/v1/anything', {}, { signal: ext.signal });
    }

    // Each call adds exactly one listener and removes it again — no leak.
    expect(addSpy).toHaveBeenCalledTimes(5);
    expect(removeSpy).toHaveBeenCalledTimes(5);
  });

  it('short-circuits when the external signal is already aborted, without adding a listener', async () => {
    global.fetch = hangingFetch();

    const ext = new AbortController();
    ext.abort();
    const addSpy = vi.spyOn(ext.signal, 'addEventListener');

    const err = await client.post('/api/v1/anything', {}, { signal: ext.signal }).catch(e => e);
    expect(err).toBeInstanceOf(NetworkError);
    // No 'abort' listener is registered on an already-aborted signal.
    expect(addSpy).not.toHaveBeenCalledWith('abort', expect.any(Function), expect.anything());
  });
});

// A non-ok response whose JSON body carries a FastAPI-style { detail }.
function detailErrorFetch(status, detail, statusText = 'Error') {
  return vi.fn(() => Promise.resolve({
    ok: false,
    status,
    statusText,
    json: () => Promise.resolve({ detail })
  }));
}

// A non-ok response whose body is not JSON (json() rejects).
function nonJsonErrorFetch(status, statusText = 'Bad Request') {
  return vi.fn(() => Promise.resolve({
    ok: false,
    status,
    statusText,
    json: () => Promise.reject(new Error('Unexpected token < in JSON'))
  }));
}

describe('APIClient error detail extraction', () => {
  let client;
  const originalFetch = global.fetch;

  beforeEach(() => {
    client = new APIClient('http://127.0.0.1:9999');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('uses the backend JSON detail string as the error message', async () => {
    global.fetch = detailErrorFetch(400, 'exiftool krävs men hittades inte i PATH.');

    const err = await client.post('/api/v1/rename-nef/preview', {}).catch(e => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.statusCode).toBe(400);
    expect(err.retryable).toBe(false);
    expect(err.message).toBe('HTTP 400: exiftool krävs men hittades inte i PATH.');
  });

  it('falls back to statusText when the body is not JSON', async () => {
    global.fetch = nonJsonErrorFetch(400, 'Bad Request');

    const err = await client.get('/api/v1/anything').catch(e => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('HTTP 400: Bad Request');
  });

  it('falls back to statusText when detail is not a string', async () => {
    // FastAPI validation errors put an array under `detail`; only strings are used.
    global.fetch = detailErrorFetch(422, [{ msg: 'x' }], 'Unprocessable Entity');

    const err = await client.post('/api/v1/anything', {}).catch(e => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.statusCode).toBe(422);
    expect(err.message).toBe('HTTP 422: Unprocessable Entity');
  });
});

describe('APIClient.clearCache', () => {
  let client;
  const originalFetch = global.fetch;

  beforeEach(() => {
    client = new APIClient('http://127.0.0.1:9999');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('resolves with the parsed JSON on success', async () => {
    global.fetch = okFetch({ cleared: 42 });
    await expect(client.clearCache()).resolves.toEqual({ cleared: 42 });
  });

  it('classifies HTTP errors the same way as get/post', async () => {
    global.fetch = httpErrorFetch(500, 'Internal Server Error');

    const clearErr = await client.clearCache().catch(e => e);
    const getErr = await client.get('/api/v1/anything').catch(e => e);

    expect(clearErr).toBeInstanceOf(NetworkError);
    expect(getErr).toBeInstanceOf(NetworkError);
    expect(clearErr.statusCode).toBe(getErr.statusCode);
    expect(clearErr.statusCode).toBe(500);
    expect(clearErr.retryable).toBe(getErr.retryable);
    expect(clearErr.retryable).toBe(true);
  });

  it('classifies a request timeout as a NetworkError timeout', async () => {
    client._requestTimeout = 10;
    global.fetch = hangingFetch();

    const err = await client.clearCache().catch(e => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.isTimeout).toBe(true);
  });
});
