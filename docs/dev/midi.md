# MIDI — device map and hardware probe

Ansikten is getting a hardware control surface: a **Behringer X-TOUCH MINI**
(8 push encoders with LED rings, 16 backlit buttons, 1 fader, two preset
layers A/B).

This document is the measurement record for that work. It contains:

1. how to run the probe,
2. six experiments (E1–E6) with procedure, an **empty** result table, and what
   the outcome decides,
3. a device map copied from the factory quick start guide, marked
   **UNVERIFIED** until E2/E5 fill it in.

**Nothing in this document is measured yet.** The tables are empty by design.
Every number that lands in them must come from a run of the probe against the
physical device — guessing values here would corrupt the decisions that are
gated on them, above all [E4](#e4--encoder-recentering-run-this-first).

Source material lives outside this repo in `chitrashala/underlag/`, chiefly
`behringer-x-touch-mini-quickstart.md` (the factory MIDI map, pages 14–15) and
`x-touch-mini-handson.md` (a reverse-engineered SysEx protocol). Everything
taken from those sources is treated here as a **claim to be verified**, not as
fact. Vendor documentation for this device is thin and partly contradicted by
community profiles.

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
| Top-8 names within a shoot (median) | **66 %** |
| Top-16 names within a shoot (median) | **97 %** |

### Three consequences, all of which revise the original plan

**1. A static top-8 name row is not viable.** Globally the eight most frequent
names cover only 38 % of 25 009 labels, and even sixteen cover just 61 % —
across 203 distinct people. A fixed row of favourites would miss roughly
two-thirds of the naming work. The name buttons must be **scoped to the
current working set**, using the working-folder anchor the app already
maintains. The same eight physical buttons carry different names in different
shoots; that is the whole point.

**2. All sixteen buttons should carry names, not eight.** Within a single
shoot, sixteen names cover 97 % of namings (median unique names per shoot:
20.5). Eight cover 66 % — a third of the work still falling through to the
keyboard. Sixteen is where the curve flattens, so the full button grid goes to
names and the **actions move to the encoder presses on note 0–7**, which are
otherwise unused. This inverts the original allocation.

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
| A: without Lightroom | input |  |  |  |  |  |  |
| A: without Lightroom | output |  |  |  |  |  |  |
| B: with Lightroom + MIDI2LR | input |  |  |  |  |  |  |
| B: with Lightroom + MIDI2LR | output |  |  |  |  |  |  |
| C: after replug | input |  |  |  |  |  |  |

| Question | Answer |
| --- | --- |
| Does the probe still receive while MIDI2LR is connected? | |
| Does MIDI2LR still receive while the probe is connected? | |
| Is `id` stable across replug? | |
| Is `id` stable across a reboot? | |

**Consequence.** Concurrent access confirmed → Ansikten can open the device
alongside MIDI2LR, and the "who owns the device" question is a UX question,
not a technical one. Concurrent access refused → Ansikten needs an explicit
take/release of the port, and the two applications must be mutually exclusive.
A **stable `id`** means the port can be remembered in preferences; an unstable
one means matching on `name` with all the fragility that implies.

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

**Results — Preset A.**

| Control | Raw status (hex) | Type | Channel 0-idx | Channel 1-idx | Number | Value range seen |
| --- | --- | --- | --- | --- | --- | --- |
| Encoder 1 turn |  |  |  |  |  |  |
| Encoder 2 turn |  |  |  |  |  |  |
| Encoder 3 turn |  |  |  |  |  |  |
| Encoder 4 turn |  |  |  |  |  |  |
| Encoder 5 turn |  |  |  |  |  |  |
| Encoder 6 turn |  |  |  |  |  |  |
| Encoder 7 turn |  |  |  |  |  |  |
| Encoder 8 turn |  |  |  |  |  |  |
| Encoder 1 press |  |  |  |  |  |  |
| Encoder 8 press |  |  |  |  |  |  |
| Upper button 1 |  |  |  |  |  |  |
| Upper button 8 |  |  |  |  |  |  |
| Lower button 1 |  |  |  |  |  |  |
| Lower button 8 |  |  |  |  |  |  |
| Fader |  |  |  |  |  |  |
| A button |  |  |  |  |  |  |
| B button |  |  |  |  |  |  |

**Results — Preset B.** (Same rows.)

| Control | Raw status (hex) | Type | Channel 0-idx | Channel 1-idx | Number | Value range seen |
| --- | --- | --- | --- | --- | --- | --- |
| Encoder 1 turn |  |  |  |  |  |  |
| Encoder 8 turn |  |  |  |  |  |  |
| Encoder 1 press |  |  |  |  |  |  |
| Upper button 1 |  |  |  |  |  |  |
| Lower button 1 |  |  |  |  |  |  |
| Fader |  |  |  |  |  |  |

| Question | Answer |
| --- | --- |
| Is "channel 11" `0xBA`/`0x9A` or `0xBB`/`0x9B`? | |
| Do buttons send note-off (`0x8n`) or note-on velocity 0 on release? | |
| Does the press/release pair arrive as two messages or one? | |
| Does anything the factory map omits also transmit? | |

**Consequence.** This table replaces the unverified factory map below and
becomes the single source for the action catalogue's binding keys. If preset A
and B differ only in numbers (not channel), a single parser handles both; if
they differ in channel, the parser needs a layer notion.

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
5. Press **Nollställ räknare + karta**, then spin the encoder as fast as you
   can for ~5 seconds. Read **topp** (peak msg/s).
6. Repeat step 5 with all eight encoders moving (or as many as you can turn at
   once) for a worst-case rate.

**Results.**

| Measurement | Value |
| --- | --- |
| Min value seen (single encoder) | |
| Max value seen (single encoder) | |
| Behaviour at the low end (clip / wrap / relative) | |
| Behaviour at the high end (clip / wrap / relative) | |
| Value delta per detent, slow turn | |
| Value delta per detent, fast turn | |
| Peak msg/s — one encoder spun fast | |
| Peak msg/s — several encoders at once | |
| Peak msg/s — fader full sweep | |

**Consequence.** Absolute-with-clipping confirmed → the knob layer must either
be redesigned around absolute values (a knob maps to a value, not a delta) or
depend on E4 succeeding. Relative encoding found → the knob layer is
straightforward and E4 becomes moot. The peak rate sets whether incoming
messages need coalescing before they reach application state; a rate above
roughly 100/s per control means a naive handler will thrash.

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

**Results.**

Record the raw value after one detent verbatim — not just "moved / didn't".
Where it landed is what identifies the mapping rule.

| Variant | Encoder | Channel used | Value written | Value `V` before | Raw value after one detent | Counter moved? (and to what) |
| --- | --- | --- | --- | --- | --- | --- |
| E4a plain ring value | 1 | | 7 | | | |
| E4a plain ring value | 5 | | 7 | | | |
| E4b Pan mode first | 1 | | 7 | | | |
| E4b Pan mode first | 5 | | 7 | | | |
| E4a, preset B | 1 | | 7 | | | |
| E4a, other value | 1 | | 1 | | | |
| E4a, other value | 1 | | 13 | | | |

| Question | Answer |
| --- | --- |
| Does the LED ring visibly respond at all? | |
| Which channel do RX messages have to be sent on? | |
| Does the ring mode (Single/Pan/Fan/Spread/Trim) change the answer? | |
| Is there a latency or rate limit on ring writes? | |

**Consequence.**

- **Counter moves — to 65/63 or to anything else** → phase 6 proceeds as
  designed: after each encoder message the host writes the ring back to a known
  position, and every knob becomes an endless relative control. This is the
  good outcome, and it does not require the counter to land on 64
  specifically — only that the write moves it predictably. Record the observed
  mapping so the host knows what to write.
- **Counter does not move (`V ± 1`)** → phase 6 must be redesigned before any
  of it is built. The remaining options are all worse: absolute knobs with dead ends;
  reconfiguring the device with the Windows-only X-TOUCH Editor in a VM (what
  every published guide resorts to); or dropping the knob layer. Which one is
  a decision for the owner, not something to pick silently.

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

**Results.**

| Note | Physical lamp that lit | Velocity 1 | Velocity 2 | Velocity 0 | Echoed back? |
| --- | --- | --- | --- | --- | --- |
| 0 | | | | | |
| 1 | | | | | |
| 7 | | | | | |
| 8 | | | | | |
| 15 | | | | | |

| Question | Answer |
| --- | --- |
| Which channel do LED messages have to be sent on? | |
| Does note 0–7 map to the upper or the lower button row? | |
| Is velocity 2 = blink confirmed? | |
| Does velocity 3–127 get ignored? | |
| **Does the device echo sent notes back on its input port?** | |
| If it echoes: same channel, or a different one? | |
| Does LED state survive a preset (A/B) switch? | |

**Consequence.** Echo present → the input path needs a filter for
self-generated messages (suppress an incoming note matching one sent within a
short window, exactly what the probe's `EKO?` heuristic does), and that filter
must exist before any LED feedback is built, not after. Echo absent → LED
output and button input are independent and the LED layer is simple. If the
LED row mapping differs from the factory table, the mapping in the action
catalogue comes from **this table**, not from the manual.

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

**Results.**

| Condition | Messages received | Of which unfocused | Received at all? |
| --- | --- | --- | --- |
| Another app focused, Chrome visible | | | |
| Another app focused, Chrome fully covered | | | |
| Chrome minimised | | | |
| Chrome window on another Space/desktop | | | |

**Consequence.** Messages arrive while unfocused (expected) → Ansikten must
gate on its own window focus explicitly, and that gate is part of the input
layer from the start rather than an afterthought. Messages stop when
unfocused → the gate is free, but the behaviour is then browser-specific and
must be re-verified in Electron before relying on it.

---

## Device map — **UNVERIFIED, filled in from E2/E5**

Everything in this section is transcribed from the factory quick start guide
(pages 14–15) via `chitrashala/underlag/behringer-x-touch-mini-quickstart.md`.
It is recorded here so the experiments have something concrete to confirm or
refute. **Do not build against it.** Replace each table with measured values
once E2 and E5 have been run, and change this heading when you do.

Note numbers are given in the notation where note 0 = C-2 (Yamaha style), as
the guide uses.

### Transmit — Preset A (guide says: MIDI channel 11)

| Control | Guide says |
| --- | --- |
| Encoder 1–8, turn | CC 1–8 |
| Encoder 1–8, press | Note 0–7 |
| Upper button row 1–8 | Note 8–15 |
| Lower button row 1–8 | Note 16–23 |
| Fader | CC 9 |

### Transmit — Preset B (guide says: MIDI channel 11)

| Control | Guide says |
| --- | --- |
| Encoder 1–8, turn | CC 11–18 |
| Encoder 1–8, press | Note 24–31 |
| Upper button row 1–8 | Note 32–39 |
| Lower button row 1–8 | Note 40–47 |
| Fader | CC 10 |

### Receive (guide says: on a "GLOBAL CH")

| Function | RX command | RX value |
| --- | --- | --- |
| Operation mode select | CC 127 | 0 = standard mode, 1 = MC mode, 2–127 ignored |
| Preset layer change | Program Change | standard mode only: 0 = layer A, 1 = layer B, 2–127 ignored |
| LED ring behaviour | Encoders 1–8: CC 1–8 | 0 = Single, 1 = Pan, 2 = Fan, 3 = Spread, 4 = Trim, 5–127 ignored |
| LED ring value | Encoders 1–8: CC 9–16 | 0 = all off, 1–13 = LED 1–13 on, 14–26 = LED 1–13 blinking, 27 = all on, 28 = all blinking, 29–127 ignored |
| Button LEDs | Upper row 1–8: note 0–7. Lower row 9–16: note 8–15 | note off or velocity 0 = off, velocity 1 = on, velocity 2 = blink, velocity 3–127 ignored |
| Layer A/B LEDs | not assignable | follows preset layer change |

**The numeric collision to watch (E5):** transmit note 0–15 (encoder presses +
upper button row) and receive note 0–15 (button LEDs) occupy the same range.

### MC mode — the trap

Holding the **MC** button while connecting USB puts the device into Mackie
Control mode, where none of the above applies: encoders become VPOTs, the
fader becomes MASTER, and the buttons become Mackie transport functions. The
MC MODE LED is lit when this is active. Every experiment above assumes
**standard mode**; check the LED before measuring.

Standard mode can be restored by repeating the MC-button-at-connect procedure,
by sending `CC 127 = 0` on the global channel, or with the SysEx CLI from
`x-touch-mini-handson.md`.

### What cannot be done from macOS

Per `x-touch-mini-handson.md`, the device's SysEx configuration protocol is
partly reverse-engineered: **reading** device info and layer configuration
works, **writing** a full configuration does not. Changing CC numbers or the
default LED ring modes therefore still requires the Windows-only X-TOUCH
Editor. Mode switching, device id and global channel *are* reachable without
it. This is the constraint that makes E4 load-bearing.

---

## Related

- [Architecture](architecture.md)
- [UX principles](ux-principles.md)
- [ROADMAP](../../ROADMAP.md) — the MIDI track and its phases
