"""Long-lived automation driver for the MIDI probe measurement session.

Keeps one headed Chrome window with a live Web MIDI connection across many
commands, so a hardware pass is not broken into per-step page loads. Driven
by single-line JSON commands over a named pipe; results come back as JSON
lines in an output log. Run it once per session:

    mkfifo /tmp/xt/cmd   # command pipe (mkdir -p /tmp/xt first if needed)
    conda run -n default --no-capture-output \
      python frontend/scripts/midi-probe/session_driver.py &
    echo '{"op":"eval","expr":"1+1"}' > /tmp/xt/cmd

Requires playwright and Google Chrome in addition to the probe itself.
Override PROBE_URL / CMD_FIFO / OUT_LOG via the environment to relocate any
of them; the permission origin follows PROBE_URL automatically.

Commands (one JSON object per line):
  {"op": "eval",  "expr": "<js>"}    -> {"ok": true, "result": <json>}
  {"op": "wait",  "js": "<predicate>", "timeout": <ms>}
       -> polls the predicate every 250 ms until truthy or the timeout;
          answers {"ok": true, "result": true|false} (false = timed out)
  {"op": "shot",  "path": "<file>"}  -> full-page screenshot
  {"op": "quit"}                     -> close browser and exit

The wait op lets a hands-on hardware pass flow without verbal
ready-acknowledgements: park it on e.g.
parseInt(document.getElementById('total').textContent) > 0 and read the
log once it returns.

Why Chrome and not Playwright's bundled Chromium: only real Chrome honours
the Web MIDI grant against CoreMIDI on macOS. Why both permissions: Chrome
denies requestMIDIAccess unless *both* `midi` and `midi-sysex` are granted,
even when the page requests access without SysEx. Verified 2026-08-23.
"""

import json
import os
import sys
import traceback
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

PROBE_URL = os.environ.get("PROBE_URL", "http://127.0.0.1:8765/probe.html")
# The permission grant must name exactly the origin the page runs from.
ORIGIN = "{0.scheme}://{0.netloc}".format(urlsplit(PROBE_URL))
CMD_FIFO = os.environ.get("CMD_FIFO", "/tmp/xt/cmd")
OUT_LOG = os.environ.get("OUT_LOG", "/tmp/xt/out.log")


def emit(line):
    with open(OUT_LOG, "a") as f:
        f.write(json.dumps(line) + "\n")
        f.flush()


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, channel="chrome")
        context = browser.new_context()
        context.grant_permissions(["midi", "midi-sysex"], origin=ORIGIN)
        page = context.new_page()
        page.goto(PROBE_URL)
        page.wait_for_load_state("networkidle")
        page.bring_to_front()
        page.click("#connect")
        page.wait_for_timeout(1500)
        status = page.locator("#status").inner_text()
        ports = page.locator("#portBody tr").count()
        if "Ansluten" not in status:
            emit({"ok": False, "phase": "ready", "status": status})
            browser.close()
            return 1
        emit({"ok": True, "phase": "ready", "status": status, "portRows": ports})

        while True:
            with open(CMD_FIFO) as fifo:
                for raw in fifo:
                    raw = raw.strip()
                    if not raw:
                        continue
                    try:
                        cmd = json.loads(raw)
                        op = cmd.get("op")
                        if op == "eval":
                            result = page.evaluate(cmd["expr"])
                            emit({"ok": True, "result": result})
                        elif op == "wait":
                            js = cmd["js"]
                            timeout = int(cmd.get("timeout", 60000))
                            result = False
                            waited = 0
                            while waited < timeout:
                                if page.evaluate(js):
                                    result = True
                                    break
                                page.wait_for_timeout(250)
                                waited += 250
                            emit({"ok": True, "result": result,
                                  "waitedMs": waited})
                        elif op == "shot":
                            page.screenshot(path=cmd["path"], full_page=True)
                            emit({"ok": True})
                        elif op == "quit":
                            emit({"ok": True, "bye": True})
                            browser.close()
                            return 0
                        else:
                            emit({"ok": False, "error": f"unknown op {op!r}"})
                    except Exception:  # noqa: BLE001 - one bad command must
                        # not kill the driver (and with it the live MIDI
                        # connection); report the failure and keep serving
                        # the pipe. page.evaluate raises arbitrary errors.
                        emit({"ok": False,
                              "error": traceback.format_exc(limit=3)})


if __name__ == "__main__":
    sys.exit(main())
