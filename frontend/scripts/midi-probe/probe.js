/*
 * MIDI probe — a standalone measuring instrument for the Behringer X-TOUCH MINI
 * (or any other MIDI device). Run it in Chrome; see docs/dev/midi.md.
 *
 * Design constraints, deliberate:
 *   - No build step, no dependencies. Plain HTML + one classic script.
 *     NOT an ES module: Chrome blocks `type="module"` over `file://` (opaque
 *     origin, CORS), and the whole point is to double-click the file and go.
 *     Everything lives inside one IIFE instead of using export/import.
 *   - Raw bytes are the product. Every decode is a convenience layered on top
 *     of a hex dump that is never hidden. If the decode and the hex disagree,
 *     the hex is right.
 *   - Nothing here is bundled into the app: `frontend/scripts/` is outside
 *     electron-builder's `build.files` allowlist.
 *
 * Code and comments in English; UI strings in Swedish (house rule).
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /** @type {MIDIAccess|null} */
  let midiAccess = null;

  /** Timestamps (ms, performance.now) of recently received messages. */
  let rateSamples = [];
  let peakRate = 0;

  /** Total messages received since last counter reset. */
  let totalReceived = 0;

  /** Recently sent messages, for echo detection: {statusByte, data1, at}. */
  let sentRecently = [];

  /** Window (ms) within which an incoming message matching a sent one is suspect. */
  const ECHO_WINDOW_MS = 500;

  /** Aggregate per control: key -> {key, label, first, last, count, min, max, value}. */
  const controlMap = new Map();

  let paused = false;
  let logRowCount = 0;
  const MAX_LOG_ROWS = 2000;

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------

  const $ = (id) => document.getElementById(id);

  const hex2 = (n) => n.toString(16).toUpperCase().padStart(2, '0');

  /** Format a byte array as space-separated uppercase hex. */
  function toHex(bytes) {
    return Array.from(bytes, hex2).join(' ');
  }

  /** Wall-clock timestamp with milliseconds, for correlating with what you did. */
  function stamp() {
    const d = new Date();
    const p = (n, w = 2) => String(n).padStart(w, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
  }

  // Note names in the notation the X-TOUCH MINI quick start guide uses,
  // where note 0 = C-2 (Yamaha style). Handy when comparing against page 14.
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  function noteName(n) {
    return `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 2}`;
  }

  // ---------------------------------------------------------------------------
  // Decoding
  // ---------------------------------------------------------------------------

  const CHANNEL_TYPES = {
    0x80: 'Note Off',
    0x90: 'Note On',
    0xa0: 'Poly Aftertouch',
    0xb0: 'Control Change',
    0xc0: 'Program Change',
    0xd0: 'Channel Aftertouch',
    0xe0: 'Pitch Bend',
  };

  const SYSTEM_TYPES = {
    0xf0: 'SysEx start',
    0xf1: 'MTC Quarter Frame',
    0xf2: 'Song Position',
    0xf3: 'Song Select',
    0xf6: 'Tune Request',
    0xf7: 'SysEx end',
    0xf8: 'Timing Clock',
    0xfa: 'Start',
    0xfb: 'Continue',
    0xfc: 'Stop',
    0xfe: 'Active Sensing',
    0xff: 'System Reset',
  };

  /**
   * Decode a raw MIDI message.
   *
   * Returns channel both 0-indexed (what the wire carries in the low nibble)
   * and 1-indexed (what manuals and editors print). Experiment E2 turns on
   * exactly this distinction: "channel 11" in the Behringer map is either
   * status 0xBA (low nibble 10) or 0xBB (low nibble 11), and only the raw
   * status byte settles it.
   *
   * @param {Uint8Array} bytes
   * @returns {{status:number, statusHex:string, type:string, channelZero:number|null,
   *            channelOne:number|null, number:number|null, value:number|null,
   *            detail:string, key:string|null, label:string|null}}
   */
  function decode(bytes) {
    const status = bytes[0];
    const out = {
      status,
      statusHex: `0x${hex2(status)}`,
      type: 'Okänd',
      channelZero: null,
      channelOne: null,
      number: null,
      value: null,
      detail: '',
      key: null,
      label: null,
    };

    if (status < 0x80) {
      // Running status or a malformed fragment; Web MIDI normally hands over
      // complete messages, so seeing this at all is itself worth noting.
      out.type = 'Datafragment (running status?)';
      return out;
    }

    if (status >= 0xf0) {
      out.type = SYSTEM_TYPES[status] || `System 0x${hex2(status)}`;
      if (status === 0xf0) {
        out.detail = `${bytes.length} byte SysEx`;
      }
      out.key = `sys:${hex2(status)}`;
      out.label = out.type;
      return out;
    }

    const family = status & 0xf0;
    const channelZero = status & 0x0f;
    out.type = CHANNEL_TYPES[family] || `0x${hex2(family)}`;
    out.channelZero = channelZero;
    out.channelOne = channelZero + 1;

    const d1 = bytes.length > 1 ? bytes[1] : null;
    const d2 = bytes.length > 2 ? bytes[2] : null;

    switch (family) {
      case 0x80:
      case 0x90:
      case 0xa0:
        out.number = d1;
        out.value = d2;
        out.detail = d1 === null ? '' : `note ${d1} (${noteName(d1)})`;
        // Note On with velocity 0 is a Note Off in disguise — say so, because
        // it decides whether a button press/release pair looks symmetric.
        if (family === 0x90 && d2 === 0) out.detail += ' — velocity 0 = note off';
        break;
      case 0xb0:
        out.number = d1;
        out.value = d2;
        out.detail = `CC ${d1}`;
        break;
      case 0xc0:
        out.number = d1;
        out.detail = `program ${d1}`;
        break;
      case 0xd0:
        out.value = d1;
        out.detail = `tryck ${d1}`;
        break;
      case 0xe0:
        // 14-bit, LSB first.
        out.value = d1 !== null && d2 !== null ? (d2 << 7) | d1 : null;
        out.detail = `bend ${out.value}`;
        break;
      default:
        break;
    }

    if (out.number !== null) {
      out.key = `${hex2(status)}:${out.number}`;
      out.label = `${out.type} ${out.detail} — kanal ${out.channelOne} (0-idx ${out.channelZero})`;
    } else {
      out.key = `${hex2(status)}`;
      out.label = `${out.type} — kanal ${out.channelOne} (0-idx ${out.channelZero})`;
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Port enumeration (E1)
  // ---------------------------------------------------------------------------

  function portRows(map, kind) {
    const rows = [];
    map.forEach((port) => {
      rows.push({
        kind,
        id: port.id,
        name: port.name || '',
        manufacturer: port.manufacturer || '',
        version: port.version || '',
        state: port.state,
        connection: port.connection,
      });
    });
    return rows;
  }

  function allPortRows() {
    if (!midiAccess) return [];
    return [
      ...portRows(midiAccess.inputs, 'input'),
      ...portRows(midiAccess.outputs, 'output'),
    ];
  }

  function renderPorts() {
    const tbody = $('portBody');
    tbody.textContent = '';
    const rows = allPortRows();

    if (rows.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
      td.className = 'empty';
      td.textContent = 'Ingen MIDI-enhet hittad. Anslut enheten och tryck "Uppdatera portar".';
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      for (const r of rows) {
        const tr = document.createElement('tr');
        for (const cell of [r.kind, r.name, r.manufacturer, r.version, r.state, r.connection, r.id]) {
          const td = document.createElement('td');
          td.textContent = cell;
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
    }

    renderOutputSelect();
    $('portCount').textContent = midiAccess
      ? `${midiAccess.inputs.size} in / ${midiAccess.outputs.size} ut`
      : '–';
  }

  function renderOutputSelect() {
    const sel = $('outPort');
    const previous = sel.value;
    sel.textContent = '';
    if (!midiAccess) return;
    midiAccess.outputs.forEach((port) => {
      const opt = document.createElement('option');
      opt.value = port.id;
      opt.textContent = port.name || port.id;
      sel.appendChild(opt);
    });
    if (previous && sel.querySelector(`option[value="${CSS.escape(previous)}"]`)) {
      sel.value = previous;
    }
    if (sel.options.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '(ingen utgångsport)';
      sel.appendChild(opt);
    }
  }

  /** Dump the current port list into the log, as an E1 record. */
  function logPorts() {
    const rows = allPortRows();
    if (rows.length === 0) {
      logNote('E1: inga portar alls.');
      return;
    }
    logNote(`E1: ${rows.length} portar —`);
    for (const r of rows) {
      logNote(
        `   [${r.kind}] name="${r.name}" manufacturer="${r.manufacturer}" ` +
          `version="${r.version}" state=${r.state} connection=${r.connection} id=${r.id}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Log
  // ---------------------------------------------------------------------------

  function appendRow(cells, className) {
    const tbody = $('logBody');
    const tr = document.createElement('tr');
    if (className) tr.className = className;
    for (const c of cells) {
      const td = document.createElement('td');
      td.textContent = c === null || c === undefined ? '' : String(c);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);

    logRowCount += 1;
    while (logRowCount > MAX_LOG_ROWS && tbody.firstChild) {
      tbody.removeChild(tbody.firstChild);
      logRowCount -= 1;
    }

    if ($('autoscroll').checked) {
      const wrap = $('logWrap');
      wrap.scrollTop = wrap.scrollHeight;
    }
  }

  /** A free-text marker row — used for experiment markers and port dumps. */
  function logNote(text) {
    appendRow([stamp(), '', 'NOTIS', '', '', '', '', text], 'note');
  }

  function logSent(portName, bytes, decoded) {
    appendRow(
      [
        stamp(),
        `→ ${portName}`,
        'TX',
        toHex(bytes),
        decoded.channelOne === null ? '' : `${decoded.channelOne} / ${decoded.channelZero}`,
        decoded.type,
        decoded.number === null ? '' : decoded.number,
        decoded.value === null ? '' : decoded.value,
      ],
      'tx',
    );
  }

  // ---------------------------------------------------------------------------
  // Receiving
  // ---------------------------------------------------------------------------

  function onMidiMessage(event) {
    const bytes = event.data;
    const now = performance.now();

    totalReceived += 1;
    rateSamples.push(now);

    const decoded = decode(bytes);
    trackControl(decoded, bytes);

    // Echo detection (E5): did we just send something that looks like this?
    const echo = sentRecently.some(
      (s) =>
        now - s.at < ECHO_WINDOW_MS &&
        s.statusByte === bytes[0] &&
        s.data1 === (bytes.length > 1 ? bytes[1] : null),
    );

    // Focus state (E6): recorded per message, so an unfocused burst is visible
    // in the log itself rather than inferred afterwards.
    const focused = document.hasFocus();

    if (!paused && passesFilter(decoded, bytes)) {
      const portName = event.target && event.target.name ? event.target.name : '?';
      const flags = [];
      if (echo) flags.push('EKO?');
      if (!focused) flags.push('OFOKUSERAD');
      appendRow(
        [
          stamp(),
          `← ${portName}${flags.length ? ' ' + flags.join(' ') : ''}`,
          'RX',
          toHex(bytes),
          decoded.channelOne === null ? '' : `${decoded.channelOne} / ${decoded.channelZero}`,
          decoded.type,
          decoded.number === null ? '' : decoded.number,
          decoded.value === null ? '' : decoded.value,
        ],
        echo ? 'rx echo' : 'rx',
      );
    }

    updateCounters();
  }

  function passesFilter(decoded, bytes) {
    if ($('hideClock').checked && (bytes[0] === 0xf8 || bytes[0] === 0xfe)) return false;
    const needle = $('filter').value.trim().toLowerCase();
    if (!needle) return true;
    const hay = `${toHex(bytes)} ${decoded.type} ${decoded.detail} ${decoded.number} ${decoded.value}`;
    return hay.toLowerCase().includes(needle);
  }

  /**
   * Maintain the per-control aggregate (E2/E3): which distinct messages the
   * device emits, how many of each, and the min/max value ever seen. The
   * min/max column is what answers "is the encoder absolute 0-127 and does it
   * clip at the ends" without having to read a thousand log lines.
   */
  function trackControl(decoded, bytes) {
    if (!decoded.key) return;
    let entry = controlMap.get(decoded.key);
    if (!entry) {
      entry = {
        key: decoded.key,
        hex: `0x${hex2(bytes[0])}`,
        label: decoded.label || decoded.type,
        number: decoded.number,
        count: 0,
        min: null,
        max: null,
        value: null,
      };
      controlMap.set(decoded.key, entry);
    }
    entry.count += 1;
    if (decoded.value !== null) {
      entry.value = decoded.value;
      entry.min = entry.min === null ? decoded.value : Math.min(entry.min, decoded.value);
      entry.max = entry.max === null ? decoded.value : Math.max(entry.max, decoded.value);
    }
    scheduleControlRender();
  }

  let controlRenderPending = false;
  function scheduleControlRender() {
    if (controlRenderPending) return;
    controlRenderPending = true;
    requestAnimationFrame(() => {
      controlRenderPending = false;
      renderControlMap();
    });
  }

  function renderControlMap() {
    const tbody = $('controlBody');
    tbody.textContent = '';
    const entries = Array.from(controlMap.values()).sort((a, b) => {
      if (a.hex !== b.hex) return a.hex < b.hex ? -1 : 1;
      return (a.number ?? -1) - (b.number ?? -1);
    });
    if (entries.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 6;
      td.className = 'empty';
      td.textContent = 'Inget mottaget ännu.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    for (const e of entries) {
      const tr = document.createElement('tr');
      for (const cell of [
        e.hex,
        e.number === null ? '' : e.number,
        e.label,
        e.count,
        e.min === null ? '' : e.min,
        e.max === null ? '' : e.max,
      ]) {
        const td = document.createElement('td');
        td.textContent = String(cell);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }

  // ---------------------------------------------------------------------------
  // Rate counter (E3)
  // ---------------------------------------------------------------------------

  function updateCounters() {
    const now = performance.now();
    rateSamples = rateSamples.filter((t) => now - t <= 1000);
    const rate = rateSamples.length;
    if (rate > peakRate) peakRate = rate;
    $('rate').textContent = String(rate);
    $('peak').textContent = String(peakRate);
    $('total').textContent = String(totalReceived);
  }

  // Keep the sliding window honest even when nothing arrives, so the rate
  // decays to 0 instead of freezing at the last burst.
  setInterval(updateCounters, 200);

  // ---------------------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------------------

  function currentOutput() {
    if (!midiAccess) return null;
    const id = $('outPort').value;
    if (!id) return null;
    return midiAccess.outputs.get(id) || null;
  }

  /**
   * Send raw bytes to the selected output and log them.
   * @param {number[]} bytes
   */
  function send(bytes) {
    const out = currentOutput();
    if (!out) {
      logNote('Kan inte skicka: ingen utgångsport vald.');
      return false;
    }
    try {
      out.send(bytes);
    } catch (err) {
      logNote(`Sändning misslyckades: ${err && err.message ? err.message : err}`);
      return false;
    }
    sentRecently.push({
      statusByte: bytes[0],
      data1: bytes.length > 1 ? bytes[1] : null,
      at: performance.now(),
    });
    // Bound the echo buffer.
    const cutoff = performance.now() - ECHO_WINDOW_MS * 4;
    sentRecently = sentRecently.filter((s) => s.at >= cutoff);

    logSent(out.name || out.id, bytes, decode(Uint8Array.from(bytes)));
    return true;
  }

  /** Build a channel-voice message from the form. */
  function sendChannelMessage(family, channelOne, number, value) {
    const status = (family & 0xf0) | ((channelOne - 1) & 0x0f);
    if (family === 0xc0 || family === 0xd0) return send([status, number & 0x7f]);
    return send([status, number & 0x7f, value & 0x7f]);
  }

  function txChannel() {
    return Number($('txChannel').value) || 1;
  }

  // ---------------------------------------------------------------------------
  // Experiment shortcuts
  // ---------------------------------------------------------------------------

  function resetMeasurement(marker) {
    controlMap.clear();
    renderControlMap();
    rateSamples = [];
    peakRate = 0;
    totalReceived = 0;
    updateCounters();
    logNote(marker);
  }

  function wireExperiments() {
    // E1 — port enumeration.
    $('e1').addEventListener('click', () => {
      refreshPorts().then(() => logPorts());
    });

    // E2 — full control sweep: clear the aggregate, then touch everything.
    $('e2').addEventListener('click', () => {
      resetMeasurement(
        'E2: rensat. Vrid varje ratt, tryck varje ratt, tryck varje knapp, dra fadern. ' +
          'Byt sedan preset (A/B) och gör om. Läs av tabellen "Enhetskarta (mätt)".',
      );
    });

    // E3 — encoder character and rate.
    $('e3').addEventListener('click', () => {
      resetMeasurement(
        'E3: rensat. Vrid EN ratt långsamt hela vägen vänster, sedan hela vägen höger ' +
          '(kolla min/max i tabellen). Vrid sedan så fort du kan och läs av topp-takten.',
      );
    });

    // E4 — the recentering question. Gate for the whole encoder phase.
    // Encoder n is 1-indexed in the UI; the manual's RX table maps
    // encoders 1-8 to CC 9-16 (LED ring value) and CC 1-8 (LED ring mode).
    $('e4a').addEventListener('click', () => {
      const n = Number($('encoder').value);
      logNote(
        `E4a: skickar ringvärde 7 (mitten) till encoder ${n}. ` +
          'Vrid sedan ratten ETT hack och läs råvärdet. ' +
          '65/63 = räknaren flyttades till mitten. ' +
          'Föregående ±1 = den flyttades INTE. ' +
          'Vilket annat värde som helst (t.ex. 8/6) = den flyttades ändå, ' +
          'men till ett läge härlett ur kransvärdet — notera vad den landade på. ' +
          'Bara den mittersta grenen är ett nej.',
      );
      sendChannelMessage(0xb0, txChannel(), 8 + n, 7);
    });
    $('e4b').addEventListener('click', () => {
      const n = Number($('encoder').value);
      logNote(
        `E4b: sätter först ringläge Pan (CC ${n} = 1) på encoder ${n}, sedan ringvärde 7. ` +
          'Samma avläsning som E4a.',
      );
      sendChannelMessage(0xb0, txChannel(), n, 1);
      sendChannelMessage(0xb0, txChannel(), 8 + n, 7);
    });

    // E5 — button LEDs. Note 0-7 upper row, 8-15 lower row, velocity 0/1/2.
    $('e5on').addEventListener('click', () => {
      logNote('E5: tänder knapp-LED note 0-15 (velocity 1). Titta efter eko i loggen.');
      for (let n = 0; n <= 15; n += 1) sendChannelMessage(0x90, txChannel(), n, 1);
    });
    $('e5blink').addEventListener('click', () => {
      logNote('E5: blinkar knapp-LED note 0-15 (velocity 2).');
      for (let n = 0; n <= 15; n += 1) sendChannelMessage(0x90, txChannel(), n, 2);
    });
    $('e5off').addEventListener('click', () => {
      logNote('E5: släcker knapp-LED note 0-15 (velocity 0).');
      for (let n = 0; n <= 15; n += 1) sendChannelMessage(0x90, txChannel(), n, 0);
    });
    $('e5step').addEventListener('click', () => {
      logNote('E5: stegar note 0-15 en i taget, 400 ms isär — notera vilken lampa som tänds.');
      let n = 0;
      const tick = () => {
        if (n > 15) return;
        sendChannelMessage(0x90, txChannel(), n, 1);
        logNote(`E5: note ${n} på — vilken lampa lyser?`);
        n += 1;
        setTimeout(tick, 400);
      };
      tick();
    });

    // E6 — focus. Each log row already carries OFOKUSERAD; this just marks the
    // window and reports the tally so the result is a number, not an impression.
    $('e6').addEventListener('click', () => {
      const startTotal = totalReceived;
      let unfocused = 0;
      const counter = (event) => {
        if (!document.hasFocus()) unfocused += 1;
        void event;
      };
      attachExtraListener(counter);
      logNote(
        'E6: 15 sekunder startade. Klicka bort fokus (annat fönster) och vrid på rattarna.',
      );
      setTimeout(() => {
        detachExtraListener(counter);
        logNote(
          `E6: klart. ${totalReceived - startTotal} meddelanden totalt, varav ${unfocused} ` +
            'togs emot medan sidan var OFOKUSERAD. >0 betyder att fokusgrinden måste vara mjukvara.',
        );
      }, 15000);
    });
  }

  /** Extra per-message listeners (used by E6) layered on top of the main handler. */
  const extraListeners = new Set();
  function attachExtraListener(fn) {
    extraListeners.add(fn);
  }
  function detachExtraListener(fn) {
    extraListeners.delete(fn);
  }

  // ---------------------------------------------------------------------------
  // MIDI access
  // ---------------------------------------------------------------------------

  function bindInputs() {
    if (!midiAccess) return;
    midiAccess.inputs.forEach((input) => {
      input.onmidimessage = (event) => {
        onMidiMessage(event);
        extraListeners.forEach((fn) => fn(event));
      };
    });
  }

  function setStatus(text, kind) {
    const el = $('status');
    el.textContent = text;
    el.className = `status ${kind || ''}`;
  }

  async function refreshPorts() {
    if (!midiAccess) return;
    bindInputs();
    renderPorts();
  }

  async function connect() {
    if (!navigator.requestMIDIAccess) {
      setStatus(
        'Web MIDI saknas i den här webbläsaren. Använd Chrome (eller Edge). ' +
          'Safari och Firefox stödjer inte Web MIDI.',
        'bad',
      );
      return;
    }
    const sysex = $('sysex').checked;
    setStatus('Begär MIDI-behörighet…', '');
    try {
      midiAccess = await navigator.requestMIDIAccess({ sysex });
    } catch (err) {
      setStatus(
        `MIDI-behörighet nekades eller misslyckades: ${err && err.message ? err.message : err}. ` +
          'Om sidan körs från file:// och ingen prompt dyker upp — servera den över ' +
          'http://localhost i stället (se docs/dev/midi.md).',
        'bad',
      );
      return;
    }

    midiAccess.onstatechange = (event) => {
      const port = event.port;
      if (port) {
        logNote(
          `Portändring: [${port.type}] "${port.name}" state=${port.state} connection=${port.connection}`,
        );
      }
      bindInputs();
      renderPorts();
    };

    bindInputs();
    renderPorts();
    setStatus(
      midiAccess.inputs.size === 0 && midiAccess.outputs.size === 0
        ? 'Ansluten till MIDI-systemet, men ingen enhet hittad. Anslut enheten — listan uppdateras automatiskt.'
        : `Ansluten. SysEx: ${sysex ? 'på' : 'av'}.`,
      midiAccess.inputs.size === 0 && midiAccess.outputs.size === 0 ? 'warn' : 'good',
    );
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  function wireControls() {
    $('connect').addEventListener('click', connect);
    $('refresh').addEventListener('click', () => {
      refreshPorts();
      if (!midiAccess) setStatus('Inte ansluten ännu — tryck "Anslut".', 'warn');
    });

    $('pause').addEventListener('click', () => {
      paused = !paused;
      $('pause').textContent = paused ? 'Återuppta logg' : 'Pausa logg';
    });

    $('clear').addEventListener('click', () => {
      $('logBody').textContent = '';
      logRowCount = 0;
    });

    $('resetCounters').addEventListener('click', () => {
      resetMeasurement('Räknare och enhetskarta nollställda.');
    });

    $('sendForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const family = Number($('msgType').value);
      const channel = Number($('sendChannel').value);
      const number = Number($('msgNumber').value);
      const value = Number($('msgValue').value);
      sendChannelMessage(family, channel, number, value);
    });

    $('rawForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const text = $('rawBytes').value.trim();
      const parts = text.split(/[\s,]+/).filter(Boolean);
      const bytes = [];
      for (const p of parts) {
        const v = parseInt(p.replace(/^0x/i, ''), 16);
        if (Number.isNaN(v) || v < 0 || v > 255) {
          logNote(`Ogiltig byte: "${p}". Skriv hex, t.ex. "F0 40 41 42 51 00 ... F7".`);
          return;
        }
        bytes.push(v);
      }
      if (bytes.length === 0) return;
      if (bytes[0] === 0xf0 && !$('sysex').checked) {
        logNote('SysEx kräver att "Begär SysEx" var ikryssad när du anslöt. Anslut om.');
        return;
      }
      send(bytes);
    });

    // Keep the two channel selectors in sync — one mental model, two forms.
    $('txChannel').addEventListener('change', () => {
      $('sendChannel').value = $('txChannel').value;
    });
    $('sendChannel').addEventListener('change', () => {
      $('txChannel').value = $('sendChannel').value;
    });
  }

  function populateSelects() {
    for (const id of ['txChannel', 'sendChannel']) {
      const sel = $(id);
      for (let c = 1; c <= 16; c += 1) {
        const opt = document.createElement('option');
        opt.value = String(c);
        opt.textContent = `${c} (0-idx ${c - 1})`;
        sel.appendChild(opt);
      }
      sel.value = '1';
    }
    const enc = $('encoder');
    for (let n = 1; n <= 8; n += 1) {
      const opt = document.createElement('option');
      opt.value = String(n);
      opt.textContent = `Encoder ${n}`;
      enc.appendChild(opt);
    }
  }

  function init() {
    populateSelects();
    wireControls();
    wireExperiments();
    renderPorts();
    renderControlMap();
    if (!navigator.requestMIDIAccess) {
      setStatus('Web MIDI saknas i den här webbläsaren. Använd Chrome.', 'bad');
    } else {
      setStatus('Redo. Tryck "Anslut" för att begära MIDI-behörighet.', '');
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
