# Database

Data files and formats used by Ansikten.

---

## Storage Location

All persistent data stored in `~/.local/share/faceid/` (XDG standard).

Override with `$XDG_DATA_HOME` environment variable.

---

## Data Files

| File | Format | Description |
|------|--------|-------------|
| `encodings.pkl` | pickle | Known faces database |
| `ignored.pkl` | pickle | Ignored face encodings |
| `hardneg.pkl` | pickle | Hard negative examples |
| `processed_files.jsonl` | JSONL | Files already processed |
| `attempt_stats.jsonl` | JSONL | Processing attempt log |
| `db_meta.json` | JSON | Schema marker (`{"schema": N}`) — skips re-normalization |
| `manual_suffixes.json` | JSON | Free-text filename suffixes keyed by content hash |
| `distinct_pairs.json` | JSON | Confirmed-distinct name pairs (e.g. twins) |
| `config.json` | JSON | User configuration |
| `rename_journal.jsonl` | JSONL | Append-only log of every rename/move/trash/restore |
| `ansikten.log` | text | Debug/error log |

The four writable collections — `encodings.pkl`, `ignored.pkl`, `hardneg.pkl`,
`processed_files.jsonl` — are the ones `load_database`/`save_database` manage;
the JSON sidecars are owned by their respective services.

> **Concurrency / integrity.** Every read takes a shared `flock` (`LOCK_SH`);
> every write goes to a temp file under an exclusive `flock` (`LOCK_EX`) and is
> then atomically `rename`d into place, so a reader never sees a half-written
> file. Pickles are loaded through a `RestrictedUnpickler` that whitelists only
> numpy/`builtins`/`collections` classes — a malicious pickle can't execute
> arbitrary code.

> `metadata.json` (`METADATA_PATH`) is a legacy path constant that is no longer
> written or read; schema/migration state now lives in `db_meta.json`.

---

## File Formats

### encodings.pkl

Known faces database. Dictionary mapping person names to encoding lists.

```python
{
    "Anna": [
        {
            "encoding": np.ndarray,    # 512-dim (InsightFace)
            "file": "250101_120000.NEF",
            "hash": "abc123...",       # SHA1 hash of source file
            "backend": "insightface",
            "backend_version": "0.7.3",
            "created_at": "2025-01-01T12:00:00"
        },
        # ... more encodings
    ],
    "Bert": [
        # ...
    ]
}
```

**Notes:**
- All encodings are InsightFace (512-dim, cosine distance)
- Legacy entries (bare numpy arrays) auto-migrate to dict format
- One person can have multiple encodings from different images
- dlib encodings (128-dim) are deprecated; remove them on demand with `scripts/archive/rensa_dlib.py` or the remove-dlib refinement endpoint

**Manual faces.** A face added by hand in review (not auto-detected) is stored as an
entry with `encoding: None`, `encoding_hash: None`, `bounding_box: None`, and
`is_manual: True`. It still records `file` and the source file's content `hash` — the
hash anchors the name to the image so the rename pipeline recovers it even after the file
is renamed (rename matches by hash and basename). A manual entry has no vector, so it
never participates in matching; it only carries the name → file association.

### ignored.pkl

List of ignored face encodings.

```python
[
    {
        "encoding": np.ndarray,
        "file": "250101_120000.NEF",
        "hash": "abc123...",
        "backend": "insightface",
        "created_at": "2025-01-01T12:00:00"
    },
    # ... more ignored faces
]
```

### hardneg.pkl

Hard negative examples - faces that should never match certain people.

```python
{
    "Anna": [
        {
            "encoding": np.ndarray,
            "reason": "Similar but different person"
        }
    ]
}
```

Both matching paths apply them: a person is skipped as a candidate when the
probe is closer than `backend_thresholds.<backend>.hard_negative_distance` to any
of that person's hard negatives. The CLI does this in `core.matching.best_matches`;
the API/GUI does it in `detection_service._match_encoding` /
`_match_encoding_alternatives`, fed by `MatchingIndex`'s per-person hard-negative
matrices (rebuilt whenever a `touches={"hardneg"}` mutation bumps the store version).

### processed_files.jsonl

One JSON object per line, tracking processed files.

```jsonl
{"name": "250101_120000.NEF", "hash": "abc123def456..."}
{"name": "250101_120001.NEF", "hash": "def456abc123..."}
```

**Fields:**
- `name`: Original filename
- `hash`: SHA1 hash of file content

### attempt_stats.jsonl

Detailed log of all processing attempts.

```jsonl
{"file": "250101_120000.NEF", "timestamp": "2025-01-01T12:00:00", "faces": [{"name": "Anna", "action": "confirmed", "confidence": 0.85}], "attempt": 1, "resolution": "midsample"}
```

**Fields:**
- `file`: Processed filename
- `timestamp`: ISO 8601 timestamp
- `faces`: Array of face results
  - `name`: Identified person (null if ignored)
  - `action`: "confirmed", "ignored", or "manual"
  - `confidence`: Match confidence (0-1)
- `attempt`: Resolution attempt (1-3)
- `resolution`: "downsample", "midsample", or "fullres"

### rename_journal.jsonl

Append-only record of every filesystem move the app performs — GUI renames,
EXIF rename-nef, restore-names, card import, and culling trash/restore — written
by `core.fs_ops`. One JSON object per line; the file grows monotonically and is
**never rotated or rewritten** (rows are tiny, a few hundred bytes each). It is
the source of truth for the "undo last batch" feature.

```jsonl
{"ts": "2026-07-14T08:15:00.123456+00:00", "op": "rename", "tool": "rename-nef", "batch_id": "9f3c…", "src": "/photos/DSC0001.NEF", "dst": "/photos/260714_101500.NEF"}
{"ts": "2026-07-14T08:16:02.001000+00:00", "op": "move", "tool": "import", "batch_id": "a1b2…", "src": "/Volumes/CARD/DSC0002.NEF", "dst": "/photos/DSC0002.NEF"}
```

**Fields:**
- `ts`: tz-aware ISO 8601 timestamp in UTC (`datetime.now(timezone.utc).isoformat()`, ends `+00:00`)
- `op`: `rename` | `move` | `copy` | `trash` | `restore`
- `tool`: originating flow — `rename`, `rename-nef`, `rename-nef-cli`,
  `restore-names`, `import`, `culling`
- `batch_id`: `uuid4().hex` shared by all rows written in one batch operation
  (the unit an undo reverses)
- `src`, `dst`: absolute source/destination paths

**Sidecar policy.** Only the *main* file's `src → dst` is journaled. Sidecars
(`.xmp`) follow the main file deterministically to `<new-stem><sidecar-suffix>`,
so reversing the main move reverses the sidecar by the same rule — they are not
recorded as separate rows. Likewise `import` records one row per transferred NEF
(op `move` or `copy` to mirror the transfer mode); an import `copy` is logged for
completeness even though undoing a copy (deleting it) is out of scope here.

**Best-effort.** A journal write can never fail the filesystem operation it
describes: `fs_ops.record` swallows and logs any write error rather than raising,
because the move has already happened on disk.

### db_meta.json

Schema marker written after the encoding collections are normalized to the
current on-disk schema (`DB_SCHEMA_VERSION`). Its presence lets `load_database`
skip the per-entry normalization pass (see [Migration](#migration)).

```json
{ "schema": 2 }
```

Written atomically (temp-file + rename). A missing/malformed marker simply
forces a full normalization pass on the next load.

### manual_suffixes.json

Free-text filename suffixes set from review, keyed by the source file's content
hash (stable across rename). Not person names — never enter `encodings.pkl` or
autocomplete. See `POST /api/v1/files/manual-suffix` in the API reference.

### distinct_pairs.json

Confirmed-distinct name pairs (people who look alike but are different, e.g.
identical twins) stored as sorted `[name_a, name_b]` pairs. The scanner uses
them to stop suggesting a merge and to trigger twin k-NN disambiguation. Managed
via the `management/distinct-pair(s)` endpoints; self-heals when a name is
removed.

### config.json

User configuration overrides.

```json
{
    "detection_model": "hog",
    "backend": {
        "type": "insightface",
        "insightface": {
            "model_name": "buffalo_l",
            "ctx_id": -1,
            "det_size": [640, 640]
        }
    },
    "backend_thresholds": {
        "insightface": {
            "match_threshold": 0.45,
            "ignore_distance": 0.35,
            "hard_negative_distance": 0.32
        }
    },
    "auto_ignore": false,
    "auto_ignore_on_fix": true,
    "max_downsample_px": 2800,
    "max_midsample_px": 4500,
    "max_fullres_px": 8000,
    "image_viewer_app": "Ansikten",
    "enrollment_quality": {
        "enabled": true,
        "min_confidence": 0.60,
        "min_crop_px": 60,
        "min_sharpness": 15.0
    },
    "trash_retention_days": 30,
    "config_version": 3
}
```

**Key settings:**

| Key | Default | Description |
|-----|---------|-------------|
| `detection_model` | `"hog"` | `"hog"` (fast) or `"cnn"` (accurate) |
| `backend.type` | `"insightface"` | InsightFace (512-dim, cosine distance) |
| `backend.insightface.det_size` | `[640, 640]` | Detection input size (letterbox target the whole image is resized to before SCRFD detection). Raising it is a supported knob that can surface smaller faces (team/wide shots) at ~quadratic detection cost — local measurement of 640 vs 1280 was recall-neutral, so the default stays 640 pending benchmark-track ground truth (B3). Accepts `[w, h]` or a single int (square). Absent key = default applies. |
| `backend_thresholds.<backend>.match_threshold` | `0.45` (insightface) | **Single source of truth** for the match distance. A name is auto-filled only below this cosine distance. Raised 0.40 → 0.45 in the face-recognition audit (2026-07): halves the "unknown" rate at zero measured false-accept cost. See the "alternatives band" note below. |
| `backend_thresholds.<backend>.ignore_distance` | `0.35` (insightface) | Distance below which a face is proposed as "ign". |
| `backend_thresholds.<backend>.hard_negative_distance` | `0.32` (insightface) | Distance below which a confirmed hard negative suppresses a person. |
| `prefer_name_margin` | `0.15` | A name must beat "ign" by this margin to win automatically. |
| `auto_ignore` | `false` | Auto-ignore unmatched faces |
| `image_viewer_app` | `"Ansikten"` | External preview app |
| `trash_retention_days` | `30` | Auto-purge culling-trash files older than N days (`0` = keep forever). Editable under Preferences → Files → Trash (Gallra). |
| `twin_margin` | `0.1` | When the top-2 candidates are a confirmed-distinct pair within this cosine distance, break the tie with a k-NN vote. |
| `twin_knn_k` | `5` | Neighbours in the twin-disambiguation k-NN vote (effective `k = min(this, photos per person)`). |
| `enrollment_quality.enabled` | `true` | Master switch for the enrollment-quality gate (FIQA proxy). When on, a clearly-bad face crop is confirmed but its encoding is withheld from the gallery. Loaded once at startup (no runtime toggle). |
| `enrollment_quality.min_confidence` | `0.60` | Minimum InsightFace detector confidence (`det_score`) to enroll. **The load-bearing signal** — calibrated on the confirmed DB: `det_score < 0.60` gates 0.5% of enrollments, ~23% of which are rank-1 failures (23× enrichment). See [face-recognition-audit-2026-07.md](face-recognition-audit-2026-07.md). |
| `enrollment_quality.min_crop_px` | `60` | Minimum shorter box side (full-res px) to enroll. A degenerate-crop floor set *below* the smallest confirmed face (~77 px), so it gates zero historical enrollments — it only guards against future junk (a tiny thumbnail, a bad manual box). |
| `enrollment_quality.min_sharpness` | `15.0` | Minimum variance-of-Laplacian sharpness to enroll. A near-flat-crop floor set below the confirmed minimum (~18); did **not** predict recognition failure on the confirmed set, so it is a degenerate-crop guard only. |
| `config_version` | `3` | Config schema version; bumped by migrations in `core/config._migrate_config`. v2 moved thresholds into `backend_thresholds`; v3 raised the InsightFace `match_threshold` 0.40 → 0.45 (only when it was exactly the audit-era 0.40 — a customized value is left untouched). |

> **Thresholds — single source of truth.** Match/ignore/hard-negative distances live
> **only** in `backend_thresholds.<backend>` (per backend, per distance metric). The legacy
> top-level flat keys `match_threshold`/`ignore_distance`/`hard_negative_distance` were
> euclidean-era (dlib) values and are no longer consulted — with InsightFace's cosine metric a
> stale `0.6` would match almost anything. On load, a one-time migration moves such legacy
> configs onto the canonical cosine thresholds and drops the flat keys (`config_version` → 2);
> a follow-up step raises an audit-era `match_threshold` of exactly `0.40` to `0.45`
> (`config_version` → 3). The wrong-metric values are **not** carried forward, and a
> user-customized `match_threshold` (anything other than exactly `0.40`) is left untouched.
>
> **Alternatives band (cosine `0.45`–`0.50`).** Auto-fill of a name requires the nearest
> encoding to be *strictly below* `match_threshold` (`0.45`). The review alternatives list
> (`_match_encoding_alternatives`), however, is the top-N nearest people ranked by distance —
> it is **not** gated by `match_threshold` (only confirmed hard negatives below
> `hard_negative_distance` are dropped). So for a nearest distance in `[0.45, 0.50)` the face
> is **not** auto-assigned (falls through `_determine_match_case` to `unknown`), yet the nearest
> person still appears as a one-click review suggestion because its confidence
> `(1 − distance)·100` is still at or above `min_confidence` (`0.5`, i.e. distance ≤ `0.50`).
> Above `0.50` the nearest person's confidence drops below `min_confidence` and it is no longer
> a credible suggestion. This band is where the reviewer, not the auto-filler, makes the call.

> **Note:** dlib backend is deprecated since January 2026. Existing dlib encodings are left in place; remove them on demand with `scripts/archive/rensa_dlib.py` or the remove-dlib refinement endpoint.

---

## Preprocessing Cache

Located in `./preprocessed_cache/` (relative to working directory).

| File Pattern | Content |
|--------------|---------|
| `{hash}.pkl` | Pickle: `(path, attempt_results)` |
| `{hash}_a{n}.jpg` | Preview image for attempt n |

Cache enables resuming after interruption. Entries deleted after consumption.

---

## File Naming Convention

Expected format: `YYMMDD_HHMMSS[-N][_names].NEF`

| Part | Required | Description |
|------|----------|-------------|
| `YYMMDD` | Yes | Date (e.g., 250101) |
| `HHMMSS` | Yes | Time (e.g., 120000) |
| `-N` | No | Burst sequence number |
| `_names` | No | Identified people |
| `.NEF` | Yes | Nikon RAW extension |

**Examples:**
```
250101_120000.NEF              # Original
250101_120000_Anna.NEF         # One person
250101_120000_Anna,_Bert.NEF   # Multiple people
250101_120000-2_Anna.NEF       # Burst sequence
```

---

## Database Operations

The canonical data layer is `core.db` (`faceid_db` is a deprecation shim that
aliases to it). Inside the FastAPI server, code goes through the process-wide
`FaceDBStore` (`api/services/db_store.py`) rather than calling `core.db`
directly — see [Architecture → Backend Data Layer](architecture.md#backend-data-layer).

### Load Database

```python
from core.db import load_database

known_faces, ignored, hard_negatives, processed = load_database()
```

### Save Database (all or a subset)

```python
from core.db import save_database

# Rewrite all four collections (default; CLI/legacy behavior)
save_database(known_faces, ignored, hard_negatives, processed)

# Rewrite only the named files — the others keep their mtime/size on disk.
# ``only`` is a subset of {'known', 'ignored', 'hardneg', 'processed'}.
save_database(known_faces, ignored, hard_negatives, processed, only={"known"})
```

A single-file save writes inline; a multi-file save writes the files in
parallel. The store uses `only=` to persist just the collections a mutation
touched, cutting write amplification from four files to one or two on the common
review paths.

### File hash / processed lookup

```python
from core.db import get_file_hash, load_processed_files

file_hash = get_file_hash("/path/to/image.NEF")   # chunked SHA1, or None
processed = load_processed_files()                 # [{"name":..., "hash":...}]
```

---

## Migration

### Legacy Formats

Old encodings (bare numpy arrays, or dicts missing backend metadata)
automatically migrate to the modern dict format on load:

```python
# Old format (legacy)
{"Anna": [np.array([...]), np.array([...])]}

# New format (auto-migrated)
{"Anna": [
    {"encoding": np.array([...]), "backend": "insightface", ...},
    {"encoding": np.array([...]), "backend": "insightface", ...}
]}
```

### Schema marker (one-time normalization)

`load_database` no longer re-normalizes every entry on every load. The first
load of an un-migrated DB runs the full pass, saves the result back (via
`save_database(only=...)`, only the collections that actually changed), and
writes `db_meta.json` (`{"schema": DB_SCHEMA_VERSION}`) atomically. Later loads
read the marker and skip the pass. Safety rules:

- Data files are rewritten only when normalization changed something (a clean
  load only drops the marker).
- If any entry is corrupt, nothing is written (no save-back, no marker) — the DB
  keeps being re-normalized each load, preserving the drop-in-memory behavior.
- A missing/malformed marker falls back to a full pass. Bump
  `DB_SCHEMA_VERSION` to force a fresh pass + re-save.

> **Note:** Any legacy dlib (128-dim) encodings are left in place; remove them on demand with `scripts/archive/rensa_dlib.py` or the remove-dlib refinement endpoint.

### Migration Scripts

Archived one-shot tools in `backend/scripts/archive/` (run from `backend/` with
`python scripts/archive/<tool>.py`):

- `scripts/archive/migrera_processed.py` - Migrate processed_files format
- `scripts/archive/update_encodings_with_filehash.py` - Add file hashes to old encodings

---

## Backup

Recommend backing up `~/.local/share/faceid/` regularly:

```bash
# Create backup
tar -czvf faceid-backup-$(date +%Y%m%d).tar.gz ~/.local/share/faceid/

# Restore
tar -xzvf faceid-backup-20250101.tar.gz -C ~/
```
