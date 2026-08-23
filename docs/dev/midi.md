# MIDI — device map and hardware probe

Ansikten is getting a hardware control surface: a **Behringer X-TOUCH MINI**
(8 push encoders with LED rings, 16 backlit buttons, 1 fader, two preset
layers A/B).

This document is the measurement record for that work. It contains:

1. how to run the probe,
2. six experiments (E1–E6) with procedure, **measured** result tables, and what
   each outcome decided,
3. a device map transcribed from the factory quick start guide and then
   confirmed or corrected against the physical device.

**Everything below was measured on 2026-08-23** against the physical unit
(firmware 1.8, Standard mode) via the probe running in real Chrome under
automation. Every number came from a probe run; where the factory guide made a
claim, the tables say whether it held. The one experiment not run to its end
is E1's replug half (USB reconnect / reboot id stability) — marked as such
where it matters.

Source material lives outside this repo in `chitrashala/underlag/`, chiefly
`behringer-x-touch-mini-quickstart.md` (the factory MIDI map, pages 14–15) and
`x-touch-mini-handson.md` (a reverse-engineered SysEx protocol). Everything
taken from those sources was treated as a **claim to be verified**; the claims
that held are marked as confirmed below, and the two that fell are corrected
in place ([the global channel](#device-map--measured-2026-08-23) and
[E4's premise](#e4--encoder-recentering-run-this-first)).

---

## Running the probe

The probe is `frontend/scripts/midi-probe/probe.html` plus `probe.js`. It is a
standalone page — no build step, no dependencies, no server required in the
common case.

```
open -a "Google Chrome" frontend/scripts/midi-probe/probe.html
```

Then press **Anslut** and accept Chrome's MIDI permission prompt.

Notes that matter:

- **Chrome only.** Web MIDI is not implemented in Safari or Firefox. The page
  says so and degrades cleanly rather than throwing.
- **Not Electron.** Running the probe in Chrome keeps the measuring loop short
  and keeps the app out of the picture entirely; Electron's own MIDI
  permission handling is a separate concern (and a separate PR).
- **`probe.js` is a classic script, not an ES module.** Chrome blocks
  `type="module"` over `file://` (opaque origin, CORS), which would defeat the
  double-click-and-go requirement. The file is one IIFE instead.
- **Open question: does `file://` actually get a MIDI permission prompt?**
  Web MIDI needs a secure context, which `file://` nominally satisfies, but a
  `file://` page has an *opaque* origin and Chrome cannot always persist a
  permission grant to one. This was **not verified** — the page was tested over
  `http://localhost`, because the tooling used to drive Chrome refuses
  `file://` URLs. So the double-click-and-go path is plausible but unproven.
  Settle it in the first minutes with the hardware; if no prompt appears,
  serve the directory over localhost and use that URL instead:
  ```
  cd frontend/scripts/midi-probe && python3 -m http.server 8000
  # then open http://localhost:8000/probe.html
  ```
  If localhost turns out to be required, say so here and stop presenting
  `file://` as the primary route.
- **SysEx** must be requested *before* connecting (checkbox), because it is a
  parameter of `requestMIDIAccess`. None of E1–E6 need it; it is there for the
  device-info message from `x-touch-mini-handson.md`.
- **`frontend/scripts/` is never shipped.** `frontend/package.json` lists only
  `main.js`, `src/**/*`, `assets/**/*` and `node_modules/**/*` under
  `build.files`, so nothing under `scripts/` ends up in a build. Verified
  2026-07-29; re-check if `build.files` changes.

### Running the probe under automation

The 2026-08-23 session drove the probe from a script instead of by hand, so a
hardware pass could flow without per-step page reloads losing the MIDI
connection:

```
mkdir -m 700 /tmp/xt && mkfifo -m 600 /tmp/xt/cmd       # private: the pipe runs JS
cd frontend/scripts/midi-probe                          # server root = probe dir
python3 -m http.server 8765 --bind 127.0.0.1 &          # port pairs with PROBE_URL's default
conda run -n default --no-capture-output \
  python session_driver.py &
echo '{"op":"eval","expr":"document.getElementById(\"e1\").click()"}' > /tmp/xt/cmd
```

`session_driver.py` keeps one headed Chrome window alive and answers four
commands (`eval`, `wait`, `shot`, `quit`) over the pipe; results land as JSON
lines in `/tmp/xt/out.log`. The driver needs **playwright** plus Google
Chrome installed (`pip install playwright`); `PROBE_URL`, `CMD_FIFO` and
`OUT_LOG` are environment-overridable and the permission origin follows
`PROBE_URL`. Two facts about the launch environment were settled the hard way
that day and are encoded in the driver:

- **Real Chrome (`channel="chrome"`), not Playwright's bundled Chromium.** The
  bundled build denies Web MIDI outright.
- **Both permissions must be granted** — `midi` *and* `midi-sysex` — even when
  the page requests access without SysEx. Granting only `midi` fails.

The `file://` question above is thereby answered for the automation path:
Playwright refuses `file://`, the probe was served over `http://localhost`,
and no permission prompt ever appeared (the grant is programmatic). The
double-click-and-go path for a human remains plausible but still unproven —
irrelevant in practice while the session runs via the driver.

### What the probe gives you

| Surface | Use |
| --- | --- |
| **Portar** | Live port list: `name`, `id`, `manufacturer`, `version`, `state`, `connection`. |
| **Enhetskarta (mätt)** | One row per *distinct* message seen, with count and the min/max value ever observed. This is the aggregate that E2 and E3 read. |
| **Logg** | Every message: timestamp, port, direction, **raw hex**, channel 1-indexed *and* 0-indexed, decoded type/number/value. Sent messages are logged too. |
| **msg/s + topp** | Sliding one-second window and its peak (E3). |
| **`EKO?` flag** | An incoming message matching something sent within 500 ms (E5). |
| **`OFOKUSERAD` flag** | The message arrived while the page did not have focus (E6). |
| **Skicka** | Free-form channel message (type/channel/number/value) and a raw-hex sender. |

The hex column is never hidden. Where the decode and the hex disagree, the hex
is right.

---

## What the logs say about the mapping

Everything above measures the *hardware*. This section measures the *work* —
what the owner actually spends review time on — so the button mapping is sized
from the corpus rather than from intuition. Same method as the Lightroom
XMP-sidecar analysis in `chitrashala/analys/resultat-2026-07.md`, applied to
Ansikten's own review log.

Reproduce with:

```
cd backend && python -m benchmarks.label_usage
```

The script reads `~/.local/share/faceid/attempt_stats.jsonl` read-only and
prints the table below. Re-run it as the corpus grows; these numbers are a
snapshot, not a constant.

### Measured

Corpus: 7 785 reviewed images, 2025-06-07 → 2026-07-17, 55 shoots (a shoot =
one source directory reviewed on one date).

| Measure | Value |
| --- | --- |
| Labels total | 25 009 (of 25 011 raw — see below) |
| — of which `ignorerad` | **10 492 (42 %)** |
| Reviews not `ok` (retry, skipped, no_faces, all_ignored) | 358 |
| Unique names, whole corpus | 203 |
| Top-8 names, globally | **38 %** |
| Top-16 names, globally | 61 % |
| Shoots with ≥ 50 namings | 42 of 55 |
| Median unique names per shoot | 20.5 |
| Mean unique names per shoot | 22.2 |
| Max unique names in one shoot | 43 |
| Top-8 names within a shoot (median / mean) | **66 %** / 66 % |
| Top-16 names within a shoot (median / mean) | **97 %** / 93 % |

Both the median and the mean are shown because the script prints both and the
decision should not rest on the more flattering one. The gap matters most for
top-16: median 97 %, mean 93 %, and one shoot needed 43 distinct names. The
conclusion below survives either figure, but sixteen buttons is not a
guarantee of full coverage in every shoot — the largest sessions will still
spill to the keyboard.

### Three consequences, all of which revise the original plan

**1. A static top-8 name row is not viable.** Globally the eight most frequent
names cover only 38 % of 25 009 labels, and even sixteen cover just 61 % —
across 203 distinct people. A fixed row of favourites would miss roughly
two-thirds of the naming work. The name buttons must be **scoped to the
current working set**, using the working-folder anchor the app already
maintains. The same eight physical buttons carry different names in different
shoots; that is the whole point.

**2. All sixteen buttons should carry names, not eight.** Within a single
shoot, sixteen names cover 97 % of namings by median and 93 % by mean (median
unique names per shoot: 20.5). Eight cover 66 % — a third of the work still
falling through to the keyboard. Sixteen is where the curve flattens, so the
full button grid goes to names and the **actions move to the encoder presses
on note 0–7**, which are otherwise unused. This inverts the original
allocation. It does not eliminate the keyboard: the largest shoot in the
corpus had 43 distinct names, so a fallback path has to remain.

**3. `ignorerad` is the single most common action, at 42 % of all labels.** It
is not one action among many; it is as frequent as the **23** most-used names
put together. It deserves the most reachable control on the device — a
dedicated, unambiguous, hard-to-miss target — rather than a seat in a row of
equals.

### What the log cannot answer

`attempt_stats.jsonl` records **outcomes, not keystrokes.** The schema
(`backend/core/attempts.py`, `log_attempt_stats`) is `timestamp`, `filename`,
`file_hash`, `attempts`, `used_attempt`, `review_results` and
`labels_per_attempt`. There is no record of navigation, view switches, culling
actions, or which key was pressed to produce any of it.

So: **name frequency is measured; action frequency is not.** The table above
ranks *names*, and the 42 % figure for `ignorerad` is a share of labels, not a
position in a ranking of actions — no other action appears in the log at all,
so none could have outranked it. Do not read this section as an ordering of
commands. Establishing which *actions* dominate would need new
instrumentation, which is an open question in [ROADMAP.md](../../ROADMAP.md)
and deliberately not built yet.

**Two malformed labels are excluded, not silently ignored.** The raw label
count is 25 011. Two entries carry an index prefix with an empty name
(`"#7\n"`, `"#2\n"`) and are dropped; **25 009 is the count after that
exclusion**, and the script prints the dropped count on its own line so the
discrepancy is always visible rather than inferred. The same two entries
explain the name count: 205 distinct label strings, minus the empty one, minus
`ignorerad` — which is an action, not a person — gives 203 names.

One further caveat: the 358 non-`ok` reviews are counted per attempt across
the whole corpus (4.6 % of reviewed images) and say only that a review did not
land cleanly on the first pass — not why.

---

## E1 — Port enumeration

**What is measured.** The exact port names and ids the device presents on
macOS/CoreMIDI, and whether those ports remain openable while Lightroom +
MIDI2LR already hold them. The second half tests the assumption that CoreMIDI
allows **multiple clients per source** — if it does not, Ansikten and MIDI2LR
cannot coexist and the whole design changes.

**Procedure.**

1. Quit Lightroom and MIDI2LR. Connect the X-TOUCH MINI over USB.
2. Open the probe, press **Anslut**, then **E1 Portuppräkning**. Record every
   row from the log.
3. Start Lightroom with MIDI2LR running and confirm MIDI2LR responds to the
   device.
4. Without touching the probe's connection, press **E1** again. Record the rows.
5. Turn a knob. Confirm in the log whether the probe *still receives* messages
   while MIDI2LR is also receiving them.
6. Disconnect and reconnect the USB cable with the probe open; record the
   `Portändring` lines (does the id stay stable across replug?).

**Results.**

| Run | Port type | `name` | `id` | `manufacturer` | `version` | `state` | `connection` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A: without Lightroom | input | X-TOUCH MINI | 566892452 | Behringer | (empty) | connected | open |
| A: without Lightroom | output | X-TOUCH MINI | -412452614 | Behringer | (empty) | connected | closed |
| B: with Lightroom + MIDI2LR | input | X-TOUCH MINI | 566892452 | Behringer | (empty) | connected | open |
| B: with Lightroom + MIDI2LR | output | X-TOUCH MINI | -412452614 | Behringer | (empty) | connected | closed |
| C: after replug | — | **not run** | | | | | |

| Question | Answer |
| --- | --- |
| Does the probe still receive while MIDI2LR is connected? | **Yes.** 18 CC messages observed in the probe while MIDI2LR drove Lightroom simultaneously. |
| Does MIDI2LR still receive while the probe is connected? | **Yes.** Knob turns moved develop sliders in LrC throughout the session. |
| Is `id` stable across replug? | **Not tested** (no replug performed). |
| Is `id` stable across a reboot? | Not tested — but the ids are **identical across processes and days**: the same `566892452`/`-412452614` that MIDI2LR's `Controllers.xml` stored during the 2026-08-18 provkörning. |

**Consequence (confirmed).** Concurrent access confirmed → Ansikten can open
the device alongside MIDI2LR, and "who owns the device" is a UX question, not
a technical one. The `id`s look stable enough to remember in preferences; the
untested replug/reboot rows are the only caveat before relying on it.

---

## E2 — Full control sweep

**What is measured.** The raw status byte for every control, in both presets.
The specific thing this settles: the factory map says both preset layers
transmit on "**MIDI channel 11**", but the wire carries a 0-indexed nibble.
Channel 11 is therefore either status `0xBA` / `0x9A` (low nibble 10) or
`0xBB` / `0x9B` (low nibble 11). Only the hex answers it, and every later
filter, matcher and comparison depends on the answer.

**Procedure.**

1. Confirm the device is in **standard mode**, not MC mode (the MC MODE LED is
   off). If it is in MC mode, all of the below is wrong — see
   [MC mode](#mc-mode-the-trap).
2. Press **A** for Preset A. Press **E2 Rensa inför kontrollsvep** in the probe.
3. Touch everything, once each, deliberately: encoder 1→8 (a small turn each),
   encoder press 1→8, upper button row 1→8, lower button row 1→8, fader
   full travel.
4. Read the **Enhetskarta (mätt)** table and transcribe it below.
5. Press **B** for Preset B and repeat from step 2 into the second table.
6. Also note what the A/B buttons themselves transmit, if anything.

**Results — Preset A.** (313 messages, sweep 2026-08-23.)

| Control | Raw status (hex) | Type | Channel 0-idx | Channel 1-idx | Number | Value range seen |
| --- | --- | --- | --- | --- | --- | --- |
| Encoder 1–8 turn | `0xBA` | CC | 10 | 11 | 1–8 | full 0–127 range when swept |
| Encoder press (down) | `0x9A` vel 127 | Note On | 10 | 11 | 0–7 | 127 |
| Encoder release | `0x8A` | Note Off | 10 | 11 | 0–7 | 0 |
| Upper button row | `0x9A`/`0x8A` | Note On/Off | 10 | 11 | 8–15 | 127 / 0 |
| Lower button row | `0x9A`/`0x8A` | Note On/Off | 10 | 11 | 16–23 | 127 / 0 |
| Fader | `0xBA` | CC | 10 | 11 | 9 | 0–127 (156 messages in one sweep) |

**Results — Preset B.** (297 messages, 57 distinct controls — the same table
with shifted numbers.)

| Control | Raw status (hex) | Type | Channel 0-idx | Channel 1-idx | Number | Value range seen |
| --- | --- | --- | --- | --- | --- | --- |
| Encoder 1–8 turn | `0xBA` | CC | 10 | 11 | 11–18 | full range |
| Encoder press/release | `0x9A`/`0x8A` | Note On/Off | 10 | 11 | 24–31 | 127 / 0 |
| Upper button row | `0x9A`/`0x8A` | Note On/Off | 10 | 11 | 32–39 | 127 / 0 |
| Lower button row | `0x9A`/`0x8A` | Note On/Off | 10 | 11 | 40–47 | 127 / 0 |
| Fader | `0xBA` | CC | 10 | 11 | 10 | 0–127 (183 messages) |

| Question | Answer |
| --- | --- |
| Is "channel 11" `0xBA`/`0x9A` or `0xBB`/`0x9B`? | **`0xBA`/`0x9A`/`0x8A`** — the wire nibble is 10; the manual's "channel 11" is 1-indexed. The probe's dual display `11 / 10` confirms it. |
| Do buttons send note-off (`0x8n`) or note-on velocity 0 on release? | **Explicit Note Off (`0x8A`).** Two messages per press: Note On vel 127 + Note Off. |
| Does the press/release pair arrive as two messages or one? | **Two.** |
| Does anything the factory map omits also transmit? | **Nothing in the map is wrong — but the A/B buttons transmit nothing at all**, neither on the active layer nor when switching layers (see below). |

Extra finding, factory map silent on it: pressing **A** while layer A is
active transmits nothing, and pressing **B** to switch A→B transmits nothing.
The layer buttons are purely local switches. Verified by a zeroed counter and
a 60 s watch around each press.

**Consequence (confirmed).** The measured tables above replace the factory map
as the binding source. Preset A and B differ only in numbers, not channel →
**a single parser with a number offset handles both layers**; no layer notion
needed in the channel logic.

---

## E3 — Encoder character and rate

**What is measured.** Two things about the encoders.

*Character:* the factory encoders are physically endless but the factory
firmware is claimed to send **absolute** values 0–127 that clip at the ends —
meaning a knob that has been turned to 127 goes dead until turned back. That
is a materially worse interaction than relative encoding, and the difference
decides how the knob layer can be designed.

*Rate:* the peak messages-per-second a fast spin produces, which sets the
budget for whatever handler sits behind the knob.

**Procedure.**

1. Press **E3 Rensa inför encodersvep**.
2. Turn encoder 1 slowly all the way counter-clockwise. Keep turning for
   several more detents after the value stops changing.
3. Turn it slowly all the way clockwise, again continuing past the point where
   it stops changing. Read `Min` and `Max` from the device map table.
4. Watch the log for whether values *wrap* (127 → 0) or *clip* (stay at 127).
5. Press **Nollställ räknare + karta**, then **Pausa logg**, then spin the
   encoder as fast as you can for ~5 seconds. Read **topp** (peak msg/s).
   Pausing matters: it stops the probe from building a DOM row per message,
   which is the one part of the receive path likely to be slower than the
   device. The rate counter and the min/max aggregate keep running while
   paused, so nothing is lost.
6. Repeat step 5 with all eight encoders moving (or as many as you can turn at
   once) for a worst-case rate.

The rate is sampled from `MIDIMessageEvent.timeStamp` — message *arrival* —
not from the moment the handler runs, so it measures the device rather than
the page. Even so, treat a suspiciously low peak as a question about the probe
before accepting it as a fact about the hardware.

**Results.** (2026-08-23, layer A, encoder 1.)

| Measurement | Value |
| --- | --- |
| Min value seen (single encoder) | 0 |
| Max value seen (single encoder) | 127 |
| Behaviour at the low end (clip / wrap / relative) | **Clip** — repeated zeros after passing the stop, no wrap (420 values, no jump >100 between neighbours) |
| Behaviour at the high end (clip / wrap / relative) | **Clip** — repeated 127s |
| Value delta per detent, slow turn | 1 per detent |
| Value delta per detent, fast turn | 1 per message; a fast spin produces more messages, never bigger steps |
| Peak msg/s — one encoder spun fast | **41** |
| Peak msg/s — several encoders at once | **71** (two hands, all eight encoders at random pace) |
| Peak msg/s — fader full sweep | **442** |

The full range is ~127 steps, one per detent; the user estimated about three
physical turns bottom→top (the 2026-08-18 provkörning estimated "just over
five" — the turn count is an order-of-magnitude 3–5, the step count ~127
stands).

**Consequence (confirmed).** Absolute-with-clipping confirmed. The knob layer
cannot be a plain delta control, and E4 was its only escape hatch — which
fell negative, see below. Rate budget: encoders peak well under 100/s and
need no coalescing; **the fader peaks at 442/s and must be coalesced before
application state** in any future handler.

---

## E4 — Encoder recentering (RUN THIS FIRST)

> **This experiment gates the entire knob phase of the plan (phase 6).** Its
> outcome decides whether relative-feeling encoders are achievable without the
> Windows-only X-TOUCH Editor. Run it before designing anything that involves
> turning a knob. Do not assume an outcome.

**What is measured.** Whether writing to an encoder's **LED ring value**
(`CC 9–16`, per the factory RX table) also moves the encoder's **internal
counter**. If it does, the host can silently re-center each knob to 64 after
every message, and an absolute encoder behaves like a relative one — with
unlimited travel in both directions and no dead ends. This is the standard
trick, and whether this specific firmware permits it is exactly what is
unverified.

Numbering note: the probe's encoder selector is 1-indexed. For encoder *n*
(1–8) it sends LED ring **value** on `CC(8+n)` = CC 9–16 and LED ring **mode**
on `CC(n)` = CC 1–8, matching the factory RX table. Whether those RX messages
must go on a *global channel* distinct from the transmit channel is part of
what this experiment finds out.

**Procedure.**

1. Connect, select the device's output port, and set the output channel. Start
   with the channel E2 established for transmit; if nothing happens, sweep
   channels 1–16 (the manual says RX happens on a "GLOBAL CH", whose factory
   value the hands-on material reports as possibly `Off`).
2. Turn encoder 1 to somewhere in the middle. Note the current raw value in
   the log — call it `V`.
3. Press **E4a Ringvärde 7**. This sends `CC(8+1)=CC 9`, value `7` — the LED
   ring's middle position. Confirm visually that the LED ring moved to centre.
   If the ring does not move, the message is not being received: fix that
   first (wrong channel, wrong port, MC mode).
4. Turn encoder 1 **exactly one detent clockwise**. Read the raw incoming value.
5. Interpret. Note that the ring value scale is **1–13** (LED positions) while
   the counter is **0–127**, so the two scales do not line up and the firmware
   has to map between them somehow. There are three outcomes, not two:
   - **65 or 63** → the write moved the counter to the middle: the firmware
     maps the ring position proportionally (7 of 13 → ~64). Relative encoders
     are achievable without the Windows editor.
   - **`V ± 1`** → the write did **not** move the counter. The LED ring is
     decorative only. **This is the only negative outcome.**
   - **Any other value** (e.g. 8 or 6, if the firmware snaps the counter to
     the raw written value instead of scaling it) → the write **did** move the
     counter, just to a position derived from the ring value by some other
     rule. Record what it landed on. Recentering still works; only the
     constant the host has to write differs.

   Do not read "neither 65/63 nor `V ± 1`" as failure. Two of the three
   branches mean the technique works — and this experiment is the gate on
   whether phase 6 has to be redesigned, so a false negative here is expensive.
6. Press **E4b Pan-läge + ringvärde 7**, which first sets the ring *mode*
   (`CC 1 = 1`, Pan) and then the value. Repeat steps 4–5. Some firmware only
   honours a value write in certain ring modes.
7. Repeat for at least one more encoder, and in both presets, before drawing a
   conclusion.
8. Also try writing a value other than 7 (e.g. 1 and 13) and check whether the
   counter tracks the *ring position* proportionally or snaps to a fixed value.

**Results.** (2026-08-23. Every write was confirmed received — the ring moved
visibly — before the counter was read.)

| Variant | Encoder | Channel used | Value written | Value `V` before | Raw value after one detent | Counter moved? (and to what) |
| --- | --- | --- | --- | --- | --- | --- |
| E4a plain ring value, sent on the transmit channel | 1 (layer B) | 11 — **ignored** (ring unmoved) | 7 | 38 | 39 | **No — V±1**; the write never reached the device |
| E4a plain ring value | 1 (layer B) | 1, after SysEx read | 7 | 39 | 40 | **No — V±1** |
| E4a plain ring value | 1 (layer B), value 1 | 1 | 1 | 42 | 43 | **No — V±1** |
| E4a plain ring value | 1 (layer B), value 13 | 1 | 13 | 43 | 44 | **No — V±1** |
| E4b Pan mode first | 1 (layer B), LrC running | 1 | 7 | 40 | 41 | **No — V±1** |
| E4b Pan mode first | 1 (layer B), clean setup | 1 | 7 | 41 | 42 | **No — V±1** |
| E4a plain ring value | 5 (layer B) | 1 | 7 | ~27 | 28 | **No** — no jump toward centre |
| E4a plain ring value | 5 (layer A) | 1 | 7 | 0 (knob sat at its end stop) | 1 | **No** |
| Fan mode first (mode 2) | 1 (layer A) | 1 | 7 | 74 — see anomaly below | 71 | see anomaly note; thereafter clean +1/detent 71→75 |
| Fan mode, ring value 13 | 1 (layer A) | 1 | 13 | 71 | 72 | **No — V±1**; then 73, 74, 75 over three more detents |
| Spread mode first (mode 3) | 1 (layer A) | 1 | 7 | 75 | 76 | **No — V±1** |
| Trim mode first (mode 4) | 1 (layer A) | 1 | 7 | 76 | 77 | **No** — then clean tracking 78…102 CW and down to 22 CCW |

| Question | Answer |
| --- | --- |
| Does the LED ring visibly respond at all? | **Yes — but only on the right receive channel** (see below). |
| Which channel do RX messages have to be sent on? | **Global channel = channel 1 from factory.** The SysEx info request (`f0 40 41 42 51 …`, handson protocol, read live with mido) answered `global ch: 0x00` = channel 1 — not `Off`. Writes on transmit channel 11 are received by no one; on channel 1 they land instantly. |
| Does the ring mode (Single/Pan/Fan/Spread/Trim) change the answer? | **No — all five were exercised** (Single = factory, plus explicit Pan, Fan, Spread and Trim writes before each value write). Every mode behaves identically for this purpose: the value write lands as a single-LED overlay, and the ring is redrawn *from the internal counter* at the next physical turn. |
| Is there a latency or rate limit on ring writes? | Not measured systematically; writes took effect with no observed delay. |

**The mechanism, established across all five modes:** a ring write is a
**single-LED overlay**. At the next physical turn the device redraws the whole
ring *from its internal counter* — Pan draws a marker at the counter's
position, Fan fills from one edge to it, Spread and Trim draw symmetrically
around the middle with counter-derived width. The redraw is why a working
recentering would have been directly visible in the ring, and why its absence
is trustworthy here.

One anomaly is recorded rather than smoothed over: during the first Fan test,
exactly one message arrived where the previous counter was 74 and the reported
value was 71 (`74 → 71`, single message, no other traffic in the gap). Three
detents' worth of movement in one report has no explanation consistent with
the rest of the session (every other detent produced exactly one message); it
may have been a merged or lost detent burst, or a firmware quirk. It does not
carry the verdict — which rests on the many clean V±1 observations either
side of it — but the table carries raw numbers instead of summary words
precisely so this row stays visible.

**Consequence — NEGATIVE.** The counter does not move on any ring write, in
any of the five ring modes, for either tested encoder, in either preset, with
values 1/7/13. This is the only negative branch of the protocol's three
outcomes: **the LED ring is decorative, and phase 6 (knobs) cannot proceed as
designed.**
Per the original plan this forces an owner decision among:

1. absolute knobs with dead ends at 0/127,
2. reconfiguring the device to relative encoding via the Windows-only
   X-TOUCH Editor (in a VM — reading config works from macOS via SysEx,
   writing does not per `x-touch-mini-handson.md`), or
3. dropping the knob layer entirely.

Not picked silently. Note the silver lining recorded the same day: the
*buttons* half of phase 6's plan (16 name buttons + actions on encoder
presses, from the corpus analysis above) does not depend on E4 at all and can
proceed regardless.

---

## E5 — LED output

**What is measured.** Whether the button LEDs can be driven from the host, on
which channel, and — the part that is easy to miss — **whether the device
echoes messages we send back to us**.

The echo risk is concrete and numeric. Per the factory map, the device
*transmits* note 0–15 (encoder presses on 0–7, upper button row on 8–15). Per
the factory RX table, the device *receives* note 0–15 for button LED control
(upper row on 0–7, lower row on 8–15). The two ranges collide exactly. If the
device echoes, a host that lights an LED will see what looks like a button
press — a feedback loop, and one that would be very hard to diagnose later.

**Procedure.**

1. Select the output port and channel (sweep channels if nothing happens).
2. Press **E5 Stega 0–15**. Note which physical lamp lights for each note
   number — do not trust the row assignment in the factory table.
3. Press **Tänd 0–15**, **Blinka 0–15**, **Släck 0–15** and confirm the
   velocity 0/1/2 = off/on/blink claim.
4. Watch the log throughout for rows flagged **`EKO?`**. Also check whether
   any `RX` row appears at all in the moments where nothing was touched.
5. Send a Note Off (`0x8n`) with the manual send form and confirm it also
   turns the LED off.
6. Try velocity 3 and velocity 127 and confirm they are ignored, as claimed.
7. Try the same on the other preset layer, and check whether the LED state
   survives a preset switch.

**Results.** (2026-08-23, send channel 1.)

| Note | Physical lamp that lit | Velocity 1 | Velocity 2 | Velocity 0 | Echoed back? |
| --- | --- | --- | --- | --- | --- |
| 0–7 (stepped) | upper row left→right, r1c1 first | on | — | — | no |
| 8–15 (stepped) | lower row left→right | on | — | — | no |
| 0–15, `Tänd` | all 16 | on | — | — | no |
| 0–15, `Blinka` | all 16 pulse | — | **blink** | — | no |
| 0–15, `Släck` | all off | — | — | off | no |
| 5, single | r1c6 | on | — | Note Off `80 05 7F` also extinguishes | no |
| 7, velocity 3 and 127 | **nothing happens** — the "3–127 ignored" claim holds at both spot-checked ends; velocities 4–126 were not swept and remain factory claims | ignored (3) | ignored (127) | — | no |

| Question | Answer |
| --- | --- |
| Which channel do LED messages have to be sent on? | **Channel 1** (the global channel, see E4). |
| Does note 0–7 map to the upper or the lower button row? | **Upper row** (0–7 upper, 8–15 lower) — the factory RX table is right. |
| Is velocity 2 = blink confirmed? | **Yes.** |
| Does velocity 3–127 get ignored? | **At the spot-checked ends, yes** (3 and 127: no reaction). The intermediate range 4–126 was not swept and remains a factory claim. |
| **Does the device echo sent notes back on its input port?** | **No.** Zero `EKO?` rows during the entire session, including every LED send. |
| If it echoes: same channel, or a different one? | Moot — there is no echo. |
| Does LED state survive a preset (A/B) switch? | **No.** Pressing B extinguished lit buttons and the whole surface (buttons + rings) re-rendered to each layer's internal values. |

**Consequence (confirmed).** Echo absent → LED output and button input are
independent and the input path needs no self-message filter — the numeric
TX/RX collision on note 0–15 is harmless in practice. The LED row mapping in
the action catalogue comes from the measured table above (which happens to
agree with the factory one). One new constraint for any future feedback
layer: **LED state does not survive a layer switch**, so a host cannot rely
on set-and-forget lighting across layer changes — and since Ansikten's plan
leaves the hardware layers unused anyway, this mainly matters if MIDI2LR runs
concurrently.

---

## E6 — Focus

**What is measured.** Whether MIDI messages reach the page while it does not
have OS focus. They almost certainly do — Web MIDI is not focus-gated the way
keyboard input is — and confirming it establishes that **the focus gate must
be implemented in software**. Without a gate, a knob turn intended for
Lightroom would also drive Ansikten in the background.

**Procedure.**

1. Press **E6 Fokustest (15 s)**.
2. Immediately click into another application (Lightroom, a text editor —
   anything that takes focus away from Chrome).
3. Turn knobs and press buttons on the device for the whole 15 seconds.
4. Return to the probe and read the summary line in the log.
5. Also check the individual log rows for the **`OFOKUSERAD`** flag.
6. Repeat with the Chrome window fully hidden behind another window, and with
   Chrome minimised, to see whether the answer differs.

**Results.** (2026-08-23.)

| Condition | Messages received | Of which unfocused | Received at all? |
| --- | --- | --- | --- |
| Formal 15 s run, user working in another program | 47 | 0 flagged (see below) | **yes** |
| Chrome hidden with Cmd+H, 12 s of knob turns | **302** | — | **yes** |
| Whole session (all experiments) | ~2 800 RX rows total | 0 flagged | **yes** |

| Question | Answer |
| --- | --- |
| Do messages arrive while the page lacks focus? | **Yes — even with the browser hidden.** The whole pass ran with the user in another program; the final proof is 302 messages under Cmd+H. |
| Caveat about the probe's own flag | `document.hasFocus()` reported `true` and `visibilityState` `"visible"` throughout — macOS per-Space focus and/or the CDP automation keeps the page "focused". The **`OFOKUSERAD` flag therefore never fired** in this setup; its reliability must be re-verified inside Electron before anything is built on it. |

**Consequence (confirmed).** Messages arrive regardless of focus and even
browser visibility → **Ansikten must gate on its own window focus explicitly,
and that gate is part of the input layer from the start**, not an
afterthought. The browser will not do it.

---

## Device map — **MEASURED 2026-08-23, partially verified**

The tables below were transcribed from the factory quick start guide
(pages 14–15 via `chitrashala/underlag/behringer-x-touch-mini-quickstart.md`)
and then checked against the physical unit by E2 and E5. Every transmit row
and the button-LED receive row are measurements; **the two receive rows
marked *not exercised* remain factory claims**, not measurements. Corrections
found during measurement are stated inline; the factory claims that fell are
marked.

Note numbers are given in the notation where note 0 = C-2 (Yamaha style), as
the guide uses.

### Transmit — Preset A (**confirmed**, wire channel nibble `0xA` = "kanal 11" 1-indexerad)

| Control | Measured |
| --- | --- |
| Encoder 1–8, turn | CC 1–8 |
| Encoder 1–8, press | Note On vel 127 + **explicit Note Off** on note 0–7 |
| Upper button row 1–8 | Note On/Off, note 8–15 |
| Lower button row 1–8 | Note On/Off, note 16–23 |
| Fader | CC 9 |
| A/B buttons | **transmit nothing** (factory map silent on them; measured silent) |

### Transmit — Preset B (**confirmed** — same channel, shifted numbers)

| Control | Measured |
| --- | --- |
| Encoder 1–8, turn | CC 11–18 |
| Encoder 1–8, press | Note 24–31 |
| Upper button row 1–8 | Note 32–39 |
| Lower button row 1–8 | Note 40–47 |
| Fader | CC 10 |

Layers differ in numbers only → one parser + number offset covers both.

### Receive (**corrected**: global channel is *kanal 1* at factory)

The guide says only "on a GLOBAL CH" without naming a value; the hands-on
material guessed the factory value might be `Off`. Measured via SysEx device
info (`f0 40 41 42 51 00 … f7`, answered `… 00 00 00 00 01 08 01 00` =
device id 0, global ch `0x00`, Standard mode, firmware 1.8, layer B):
**the global channel is channel 1** (`0x12` would be Off; settable via the
SysEx `globch` message). Every RX write sent to transmit channel 11 was
silently ignored until this was known — including LED-ring mode writes during
the 2026-08-18 provkörning, which explains their non-effect there.

| Function | RX command | RX value | Verified |
| --- | --- | --- | --- |
| Operation mode select | CC 127 | 0 = standard, 1 = MC mode | **not exercised — factory claim** (device already in standard) |
| Preset layer change | Program Change | 0 = layer A, 1 = layer B | **not exercised — factory claim** |
| LED ring behaviour | Encoders 1–8: CC 1–8 | 0 Single / 1 Pan / 2 Fan / 3 Spread / 4 Trim | received on channel 1; **the effect is overridden by the device's own drawing at the next turn** |
| LED ring value | Encoders 1–8: CC 9–16 | factory claim: 0 = all off, 1–13 = LED on, 14–26 = blinking, 27/28 = all (on/blinking), 29–127 ignored. **Only 1, 7 and 13 were exercised** — the other ranges remain factory claims | received on channel 1 for the tested values; **does not move the counter**, in any of the five modes (E4) — a pure overlay |
| Button LEDs | Upper row: note 0–7. Lower row: note 8–15 | vel 0/off = off, 1 = on, 2 = blink, 3–127 ignored | vel 0/1/2 **measured**; 3 and 127 spot-checked as ignored; 4–126 remain factory claims |
| Layer A/B LEDs | not drivable | follow the layer switch | confirmed; the whole surface re-renders on a layer change |

### MC mode — the trap

Holding the **MC** button while connecting USB puts the device into Mackie
Control mode, where none of the above applies. The MC MODE LED was **off**
throughout the session; standard mode held. Per `x-touch-mini-handson.md`,
mode can also be set back without Windows via SysEx (`f0 40 41 42 59 00 …`)
or CC 127 = 0 on the global channel.

### What cannot be done from macOS

Unchanged by this session's measurements: reading device info and layer
configuration works via SysEx (device info read live with mido during E4),
**writing** a full configuration does not. Changing CC numbers or default LED
ring modes still requires the Windows-only X-TOUCH Editor. Combined with E4's
negative outcome, that constraint is what makes the phase 6 owner decision
real: no scriptable path to relative encoders exists.

---

## Related

- [Architecture](architecture.md)
- [UX principles](ux-principles.md)
- [ROADMAP](../../ROADMAP.md) — the MIDI track and its phases
