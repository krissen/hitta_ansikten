# API Reference

REST and WebSocket API for the Ansikten backend.

---

## Overview

- **Base URL**: `http://127.0.0.1:5001` (endpoint paths below include the full `/api/v1/...` prefix)
- **WebSocket**: `ws://127.0.0.1:5001/ws/progress`
- **Format**: JSON
- **API Version**: v1

---

## Health Check

### `GET /health`

Check backend status and component readiness.

**Response (all ready):**
```json
{
  "status": "ok",
  "service": "ansikten-backend",
  "version": "1.4.1",
  "components": {
    "backend": { "state": "ready", "message": "Connected" },
    "database": { "state": "ready", "message": "42 persons" },
    "mlModels": { "state": "ready", "message": "Ready (2.3s)" }
  }
}
```

**Response (starting up):**
```json
{
  "status": "starting",
  "service": "ansikten-backend",
  "version": "1.4.1",
  "components": {
    "backend": { "state": "ready", "message": "Connected" },
    "database": { "state": "loading", "message": "Läser in..." },
    "mlModels": { "state": "pending", "message": "Waiting..." }
  }
}
```

**Status values:**
- `ok` - All components ready
- `starting` - Still initializing
- `degraded` - One or more components have errors

---

## Face Detection

### `POST /api/v1/detect-faces`

Detect faces in an image.

**Request:**
```json
{
  "image_path": "/path/to/image.NEF",
  "force_reprocess": false
}
```

**Response:**
```json
{
  "image_path": "/path/to/image.NEF",
  "faces": [
    {
      "face_id": "face_0_abcd1234",
      "bounding_box": { "x": 100, "y": 150, "width": 200, "height": 200 },
      "confidence": 0.85,
      "person_name": "Anna",
      "is_confirmed": false,
      "match_case": "name",
      "ignore_distance": 0.42,
      "ignore_confidence": 58,
      "match_alternatives": [
        { "name": "Anna", "distance": 0.35, "confidence": 78, "is_ignored": false }
      ],
      "encoding_hash": "sha1...",
      "disambiguated": null
    }
  ],
  "processing_time_ms": 123.4,
  "cached": false,
  "file_hash": "sha1..."
}
```

`disambiguated` is normally `null`. When the top-2 candidates are a registered
confirmed-distinct pair (see `distinct-pairs`) and nearly equidistant from the
probe (within `twin_margin`), a k-NN vote over both people's confirmed photos
re-decides the suggested name and this field records it:
`{ "between": ["Wilmer", "Maximilian"], "chosen": "Wilmer", "method": "knn", "k": 5 }`.
When set, the chosen name is also moved to the front of `match_alternatives` (so
the recommended option matches the decision); the remaining alternatives keep
their distance order. Tuned by `twin_margin` / `twin_knn_k` in `config.json`.

### `GET /api/v1/face-thumbnail`

Get cropped face thumbnail.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `image_path` | string | Path to source image |
| `x` | int | Bounding box X |
| `y` | int | Bounding box Y |
| `width` | int | Bounding box width |
| `height` | int | Bounding box height |
| `size` | int | Output size (default: 150) |

**Response:** JPEG image binary

### `POST /api/v1/confirm-identity`

Confirm face identity and save to database.

**Request:**
```json
{
  "face_id": "face_0_abcd1234",
  "person_name": "Anna",
  "image_path": "/path/to/image.NEF",
  "suggested_name": "Ann"
}
```

**Response:**
```json
{
  "status": "success",
  "person_name": "Anna",
  "encodings_count": 12
}
```

### `POST /api/v1/ignore-face`

Mark face as ignored.

**Request:**
```json
{
  "face_id": "face_0_abcd1234",
  "image_path": "/path/to/image.NEF"
}
```

**Response:**
```json
{
  "status": "success",
  "ignored_count": 42
}
```

### `POST /api/v1/mark-review-complete`

Mark file review as complete, log to attempt_stats.

**Request:**
```json
{
  "image_path": "/path/to/image.NEF",
  "reviewed_faces": [
    {
      "face_index": 0,
      "face_id": "face_0_abcd1234",
      "encoding_hash": "sha1...",
      "person_name": "Anna",
      "is_ignored": false
    },
    {
      "face_index": 1,
      "face_id": "face_1_efgh5678",
      "encoding_hash": "sha1...",
      "person_name": null,
      "is_ignored": true
    }
  ],
  "file_hash": "sha1..."
}
```

**Response:**
```json
{
  "status": "success",
  "message": "Review logged for 2 faces",
  "labels_count": 2
}
```

### `POST /api/v1/batch-confirm`

Confirm and/or ignore multiple faces in a single request with one database save.
More efficient than issuing individual `confirm-identity` / `ignore-face` calls
when saving all of an image's faces at once (the review flow submits here).

**Request:**
```json
{
  "confirmations": [
    {
      "face_id": "face_0_abcd1234",
      "person_name": "Anna",
      "image_path": "/path/to/image.NEF",
      "suggested_name": "Ann"
    }
  ],
  "ignores": [
    { "face_id": "face_1_efgh5678", "image_path": "/path/to/image.NEF" }
  ]
}
```

`suggested_name` is optional (records what the scanner proposed, for
hard-negative learning when the user corrected it). Both arrays default to
empty.

**Response:**
```json
{
  "status": "success",
  "confirmed_count": 1,
  "ignored_count": 1,
  "errors": []
}
```

`errors` collects per-item failures without aborting the rest of the batch.

### `POST /api/v1/reload-database`

Reload face database from disk.

**Response:**
```json
{
  "status": "success",
  "people_count": 42,
  "ignored_count": 12,
  "cache_cleared": 10
}
```

---

## Database

### `GET /api/v1/database/people`

Get all people with encoding counts.

**Response:**
```json
[
  { "name": "Anna", "encodingCount": 12 },
  { "name": "Bert", "encodingCount": 8 }
]
```

### `GET /api/v1/database/people/names`

Get list of person names (for autocomplete).

**Response:**
```json
["Anna", "Bert", "Carl"]
```

---

## Statistics

### `GET /api/v1/statistics/summary`

Get complete statistics summary.

**Response:**
```json
{
  "totalPeople": 42,
  "totalEncodings": 156,
  "totalProcessed": 1234,
  "topFaces": [
    { "name": "Anna", "count": 12 }
  ],
  "recentImages": [
    { "filename": "250101_120000.NEF", "timestamp": "2025-01-01T12:00:00" }
  ]
}
```

### `GET /api/v1/statistics/attempt-stats`

Get attempt statistics table.

### `GET /api/v1/statistics/top-faces`

Get top faces by encoding count.

### `GET /api/v1/statistics/recent-images`

Get recently processed images.

**Query:** `?n=3` (default: 3)

### `GET /api/v1/statistics/recent-logs`

Get recent log entries.

**Query:** `?n=3` (default: 3)

### `GET /api/v1/statistics/processed-files`

Get processed files list.

**Query:** `?n=200&source=cli`

### `POST /api/v1/statistics/file-stats`

Get face-detection stats for specific files. Provide `filepaths` (preferred —
resolved by content hash, so the lookup survives renames) and/or `filenames`.

**Request:**
```json
{
  "filepaths": ["/path/to/250101_120000.NEF"],
  "filenames": ["250101_120001.NEF"]
}
```

**Response:** an object keyed by filename; only files with a match in the
attempt log are included.
```json
{
  "250101_120000.NEF": { "face_count": 3, "persons": ["Anna", "Bert"] }
}
```

---

## Management

### `GET /api/v1/management/stats`

Quick database statistics for UI.

**Response:**
```json
{
  "peopleCount": 42,
  "encodingsCount": 156,
  "processedCount": 1234,
  "ignoredCount": 23
}
```

### `GET /api/v1/management/database-state`

Get current database state.

### `GET /api/v1/management/find-duplicates`

Find pairs of distinctly-named people whose faces look like the same person
(centroid cosine distance ≤ `threshold`), as merge candidates. People with no
usable encoding (e.g. only manual faces) are skipped. Pairs in the
confirmed-distinct registry (see below) are omitted.

Each pair also carries a head-to-head **separability**: a 1-NN leave-one-out
accuracy over the two people's confirmed embeddings (`null` when either has <2
usable encodings). ~1.0 means cleanly separable (different people who look alike,
e.g. twins) and sets `likely_distinct: true`; ~0.5 means indistinguishable
(likely the same person). `likely_distinct` pairs sort last.

**Query params:** `threshold` (float, default `0.35`; lower = stricter).

**Response:**
```json
{
  "pairs": [
    { "name_a": "Elis", "name_b": "Elis Niemi", "distance": 0.18,
      "count_a": 3, "count_b": 12, "separability": 0.5, "margin": -0.01,
      "likely_distinct": false }
  ],
  "threshold": 0.35,
  "people_compared": 42
}
```
Resolve a pair by calling `merge-people` (`source_names: ["<drop>"]`, `target_name: "<keep>"`).

### Confirmed-distinct pairs (`distinct-pairs`)

People who look alike but are different (e.g. identical twins) can be marked so
the scanner stops suggesting them. Stored in `distinct_pairs.json` as sorted
name-pairs.

- `GET /api/v1/management/distinct-pairs` → `{ pairs: [{name_a, name_b}], count }`.
  Pairs whose names no longer exist are pruned (self-healing).
- `POST /api/v1/management/distinct-pair` `{name_a, name_b}` → add (400 if the names
  are equal/empty or either person doesn't currently exist).
- `POST /api/v1/management/distinct-pair/remove` `{name_a, name_b}` → un-exclude.

### `GET /api/v1/management/redundant-encodings`

Per-person count of redundant encodings *within* a person. `threshold` (query,
default `0.0`, cosine distance): `0.0` counts only exact (byte-identical)
duplicates; higher also counts near-identical ones. Manual faces are never
counted. Lists only people with redundancy.

**Response:** `{ people: [{name, total, redundant, kept}], threshold, total_redundant }`.

### `POST /api/v1/management/dedup-people`

Remove redundant encodings from the named people, keeping one per group.

**Request:** `{ names: ["Anna", …], threshold: 0.0, dry_run: false }`. With
`dry_run: true` nothing is removed (preview). Returns `OperationResponse` with
`removed_per_person`, `total_removed`, and `new_state`.

### `POST /api/v1/management/rename-person`

Rename person in database.

**Request:**
```json
{
  "oldName": "Anna",
  "newName": "Anna S"
}
```

### `POST /api/v1/management/merge-people`

Merge multiple people into target.

**Request:**
```json
{
  "sourceNames": ["Anna", "Anna S"],
  "targetName": "Anna Svensson"
}
```

### `DELETE /api/v1/management/delete-person`

Delete person from database.

**Request:**
```json
{
  "name": "Unknown"
}
```

### `POST /api/v1/management/move-to-ignore`

Move person's encodings to ignored list.

**Request:**
```json
{
  "name": "Unknown"
}
```

### `POST /api/v1/management/move-from-ignore`

Move encodings from ignored to person.

**Request:**
```json
{
  "name": "Anna",
  "count": 5
}
```

### `POST /api/v1/management/undo-file`

Undo processing for files matching pattern.

**Request:**
```json
{
  "pattern": "250101_*"
}
```

### `POST /api/v1/management/purge-encodings`

Remove last X encodings from person.

**Request:**
```json
{
  "name": "Anna",
  "count": 3
}
```

### `GET /api/v1/management/recent-files`

Get last N processed files.

**Query:** `?n=10` (default: 10)

---

## Preprocessing

### `GET /api/v1/preprocessing/cache/status`

Get cache status.

**Response:**
```json
{
  "enabled": true,
  "entryCount": 42,
  "sizeBytes": 1234567
}
```

### `POST /api/v1/preprocessing/cache/settings`

Update cache settings.

### `DELETE /api/v1/preprocessing/cache`

Clear all cache entries.

### `DELETE /api/v1/preprocessing/cache/{file_hash}`

Remove specific cache entry.

### `POST /api/v1/preprocessing/hash`

Compute SHA1 hash of file.

**Request:**
```json
{
  "file_path": "/path/to/image.NEF"
}
```

### `POST /api/v1/preprocessing/check`

Check what's cached for a file.

### `POST /api/v1/preprocessing/nef`

Convert NEF to JPG with caching.

**Request:**
```json
{
  "file_path": "/path/to/image.NEF",
  "force": false
}
```

### `POST /api/v1/preprocessing/faces`

Detect faces with caching.

### `POST /api/v1/preprocessing/thumbnails`

Generate face thumbnails with caching.

### `POST /api/v1/preprocessing/all`

Run all preprocessing steps.

### `GET /api/v1/preprocessing/preview-thumb`

Whole-frame overview thumbnail (JPEG) for the culling grid. Downscales a JPEG or
RAW file to `size` px on the longest edge. RAW files use the embedded preview
(fast) with a full-decode fallback; EXIF orientation is honoured.

**Query parameters:**
- `path` — absolute path to the source image
- `size` — longest-edge size in px (default `256`, clamped to `32`–`1024`)

**Response:** `image/jpeg` bytes, with `Cache-Control: public, max-age=604800`
and `X-Cache: HIT|MISS`.

Cached under `~/.cache/ansikten/grid/`, keyed on a cheap path + mtime + size
fingerprint (no full-file hashing), so an in-place re-export refreshes the
thumbnail automatically. Errors: `404` (missing file), `400` (path is a
directory).

---

## Files

### `GET /api/v1/files/rename-config`

Get rename configuration and presets.

### `POST /api/v1/files/rename-preview`

Preview proposed file renames.

**Request:**
```json
{
  "files": ["/path/to/250101_120000.NEF"],
  "options": {
    "includeIgnored": false
  }
}
```

### `POST /api/v1/files/rename`

Execute file renames.

**Request:**
```json
{
  "renames": [
    {
      "oldPath": "/path/to/250101_120000.NEF",
      "newPath": "/path/to/250101_120000_Anna.NEF"
    }
  ]
}
```

### `GET /api/v1/files/manual-suffix`

Get the stored free-text filename suffix for an image (for UI prefill).

**Query:** `image_path` — absolute path to the image.

**Response:**
```json
{ "hash": "<sha1>", "suffix": "vinbar", "raw": "vinbär" }
```

`suffix` is the normalized (filesystem-safe) form; `raw` is the stored text. Both are `""` when no suffix is set.

### `POST /api/v1/files/manual-suffix`

Set or clear the free-text filename suffix for an image. The suffix is **not** a person name — it never reaches `encodings.pkl`, name autocomplete, or the person pipeline. It is stored keyed by content hash (`manual_suffixes.json` under `BASE_DIR`, stable across rename) and appended after any person names when the file is renamed. An empty / whitespace-only / path-only suffix clears the entry.

**Request:**
```json
{ "image_path": "/path/to/260401_140101.jpg", "suffix": "vinbär" }
```

**Response:** same shape as the GET (returns the normalized preview + stored raw).

---

## Refinement

Endpoints for filtering outlier encodings and maintaining database quality.

### `GET /api/v1/refinement/preview`

Preview what encodings would be removed.

**Query Parameters:**
| Parameter | Default | Description |
|-----------|---------|-------------|
| `person` | null | Person name or `*` for all |
| `mode` | `std` | Filter mode: `std`, `cluster`, `mahalanobis`, or `shape` |
| `std_threshold` | 2.0 | Standard deviations for outlier detection |
| `cluster_dist` | 0.35 | Max cosine distance from centroid |
| `cluster_min` | 6 | Minimum cluster size |
| `mahalanobis_threshold` | 3.0 | Mahalanobis distance threshold |
| `min_encodings` | 8 | Skip filtering if fewer encodings |

**Response:**
```json
{
  "preview": [
    {
      "person": "Anna",
      "total": 15,
      "keep": 12,
      "remove": 3,
      "remove_indices": [2, 7, 14],
      "reason": "std outlier",
      "stats": {
        "min_dist": 0.21,
        "max_dist": 0.48,
        "mean_dist": 0.31,
        "std_dist": 0.08
      }
    }
  ],
  "summary": {
    "total_people": 42,
    "affected_people": 5,
    "total_remove": 12
  }
}
```

### `POST /api/v1/refinement/apply`

Apply filtering to remove outlier encodings.

**Request:**
```json
{
  "mode": "mahalanobis",
  "persons": ["Anna", "Bert"],
  "mahalanobis_threshold": 3.0,
  "min_encodings": 8,
  "dry_run": false
}
```

**Response:**
```json
{
  "status": "ok",
  "dry_run": false,
  "removed": 5,
  "by_person": { "Anna": 3, "Bert": 2 }
}
```

### `POST /api/v1/refinement/repair-shapes`

Remove encodings with inconsistent shapes (keeps majority shape).

**Request:**
```json
{
  "persons": ["Anna"],
  "dry_run": true
}
```

**Response:**
```json
{
  "status": "ok",
  "dry_run": true,
  "total_removed": 2,
  "repaired": [
    {
      "person": "Anna",
      "removed": 2,
      "total": 15,
      "kept_shape": [512],
      "removed_shapes": [[128], [128]]
    }
  ]
}
```

### `POST /api/v1/refinement/remove-dlib`

Remove ALL dlib (128-dim) encodings. dlib backend is deprecated.

**Request:**
```json
{
  "dry_run": true
}
```

**Response:**
```json
{
  "status": "ok",
  "dry_run": true,
  "total_removed": 45,
  "by_person": { "Anna": 10, "Bert": 8 },
  "people_affected": 12
}
```

---

## Player Count

Counts images per named player from filenames (no face recognition; the
filename format `YYMMDD_HHMMSS[-N]_Name1,_Name2.ext` is parsed). Backs the
**Räkna spelare** module.

### `POST /api/v1/players/count`

Resolve a folder/glob/date selection and return per-player counts with
median-baseline over/under-representation statistics.

**Request:**
```json
{
  "roots": ["/path/to/folder"],
  "globs": ["~/Pictures/250601*.jpg"],
  "extension_preset": "jpg",
  "extensions": null,
  "recursive": true,
  "date_from": "2025-06-01",
  "date_to": "2025-06-01",
  "gap_minutes": 30,
  "baseline": "median",
  "min_images": 3,
  "per_match": false,
  "tranare": null,
  "publik": null
}
```

`extension_preset` is one of `jpg` (jpg/jpeg), `nef`, `raw`, `images`, `all`
(case-insensitive); `extensions` overrides it with an explicit list. `date_from`/
`date_to` accept `YYYY-MM-DD` or `YYMMDD` and filter on the filename date.
At least one of `roots`/`globs` is required.

**Response:**
```json
{
  "total_images": 120,
  "time_range": { "start": "2025-06-01T10:00:00", "end": "2025-06-01T12:30:00", "duration_minutes": 150.0 },
  "baseline": 8.0,
  "baseline_method": "median",
  "players": [
    { "name": "Anna", "count": 10, "pct": 8.3, "delta_n": 2.0, "delta_pct": 25.0, "level": "high", "timestamps": ["2025-06-01T10:00:00"] }
  ],
  "excluded": {
    "tranare": [], "publik": [], "grupp": [{ "name": "Laget", "count": 3, "pct": 2.5 }],
    "below_threshold": [{ "name": "Cesar", "count": 2, "pct": 1.7 }]
  },
  "matches": [],
  "files_resolved": 123
}
```

`level` is `ok`/`warn`/`high` (mirrors the CLI ±10/±20 % thresholds). `matches`
is populated only when `per_match` is true.

`gap_minutes` (match split), `baseline` (`median`/`mean`) and `min_images` map to
the CLI's `--gap-minutes`/`--baseline`/`--min-images`. `tranare`/`publik` override
the coach/audience exclusion lists for this request only (`null` keeps the
config/env defaults); the built-in always-markers (`Laget`/`FBK` group, `Klacken`
audience) are merged in regardless and can't be overridden.

### `GET /api/v1/players/exclusions`

Return the currently resolved coach/audience/group exclusion lists (config/env +
always-markers), so the GUI can pre-fill its editor.

**Response:**
```json
{
  "tranare": ["Coach"],
  "publik": ["Klacken"],
  "grupp": ["FBK", "Laget"],
  "always": { "publik": ["Klacken"], "grupp": ["FBK", "Laget"] },
  "env_active": false,
  "env_keys": []
}
```

`always` is the **configured** always-excluded set (grupp/publik), defaulting to
the built-ins `Laget`/`FBK` and `Klacken` when the config doesn't override them —
it's now editable, not a fixed built-in. `env_active`/`env_keys` report which
`RAKNA_*` env vars are shadowing the config (so the GUI can warn that "save as
default" won't take effect).

### `POST /api/v1/players/exclusions`

Persist exclusion lists to `rakna_spelare.json` as the new defaults (applies to
future counts and the CLI). Returns the same shape as the `GET`.

**Request:**
```json
{
  "tranare": ["Coach"],
  "publik": ["Uncle"],
  "grupp": [],
  "always_grupp": ["Laget", "FBK", "Forward"],
  "always_publik": ["Klacken"]
}
```

`tranare`/`publik` are required (a partial/empty `{}` is rejected so it can't wipe
the config). `grupp`, `always_grupp`, `always_publik` are optional — `null`/omitted
leaves each unchanged. The always-markers are stored in their own keys
(`always_grupp`/`always_publik`) and stripped from the regular grupp/publik lists;
a present-but-empty `always_*` clears that always-set. Configure your own
always-excluded markers (e.g. a `Forward` group label) or drop a built-in here.

> Note: `RAKNA_TRANARE`/`PUBLIK`/`GRUPP` and `RAKNA_ALWAYS_GRUPP`/`PUBLIK` env vars
> override the config file, so a saved default has no effect while the matching
> env var is set (surfaced via `env_active`/`env_keys`).

---

## Culling

Backs the **Gallra spelare** module: list a player's JPEGs and soft-delete /
restore them via an app-managed trash (`~/.local/share/faceid/trash/`, manifest-
backed). Trashed files are automatically excluded from listing and counting.

### `POST /api/v1/culling/files`

List image files for the current filter. `player` is an exact parsed-name
filter; `name_glob` is a case-insensitive Finder-style basename pattern
(e.g. `*ArvidW*`) applied to the resolved files. `extension_preset` selects the
file types (`jpg`/`nef`/`raw`/...). Other fields match `/players/count`.

Unlike `/players/count`, this lists files **without** a `_Name` part too (e.g.
`YYMMDD_HHMMSS.NEF` from general culling before names are assigned); their date
is read from the `YYMMDD_HHMMSS` prefix and they contribute no `players` entries.

**Response:**
```json
{
  "files": [
    { "path": "/path/250601_100000_Anna.jpg", "basename": "250601_100000_Anna.jpg", "names": ["Anna"], "datetime": "2025-06-01T10:00:00", "mtime_ms": 1717236000000, "size": 4096 }
  ],
  "players": ["Anna", "Bertil"]
}
```

`players` lists every name present across the resolved files (computed before
the `name_glob`/`player` filter, so the dropdown stays complete).

Each file also carries an `mtime_ms`/`size` fingerprint (integer ms + bytes) so
the overview grid can cache-bust a thumbnail after an in-place re-export. Both
fields are **omitted** for a file that can't be stat'd (e.g. removed between the
scan and the response), so consumers must treat them as optional.

### `POST /api/v1/culling/trash`

Move files (and their `.xmp` sidecars) to the app trash.

**Request:** `{ "paths": ["/path/250601_100000_Anna.jpg"] }`

**Response:** `{ "trashed": [{ "id": "…", "original_path": "…", "basename": "…" }], "errors": [] }`

### `POST /api/v1/culling/rename`

Rename a single file (and its `.xmp` sidecars) to a new basename within the same
folder. The basename must be a bare filename (no path separators / `..`); the
request is rejected if the target file — or any sidecar's target — already
exists (so a rename never half-applies). Case-only renames are supported.

**Request:** `{ "path": "/path/250601_100000_Anna,_Bo.jpg", "new_basename": "250601_100000_Anna.jpg" }`

**Response:** `{ "path": "/path/250601_100000_Anna.jpg", "basename": "250601_100000_Anna.jpg" }`

### `GET /api/v1/culling/trash`

List the items currently in the trash: `{ "items": [{ "id", "original_path", "basename", "sidecars", "trashed_at" }] }`.

### `POST /api/v1/culling/restore`

Restore trashed items to their original location. Never overwrites: if the
original path is occupied, the file is restored as `<stem>-restored<ext>` (and
sidecars follow it).

**Request:** `{ "ids": ["…"] }`
**Response:** `{ "restored": [{ "id": "…", "restored_path": "…" }], "errors": [] }`

### `POST /api/v1/culling/empty`

Permanently delete trashed items. `{ "ids": [...] }` deletes those ids; omit
`ids` to empty the whole trash. Response: `{ "deleted": <count> }`.

---

## Import

Transfer NEFs off a camera card and eject it. Backs the **Importera** module.
macOS-only (`diskutil`); the volume list is empty on other platforms.

### `GET /api/v1/import/volumes`

List ejectable/external card volumes (never the internal disk).

**Response:**
```json
{ "volumes": [ { "name": "NIKON Z 9", "mount": "/Volumes/NIKON Z 9", "nef_count": 312, "total_bytes": 12884901888, "ejectable": true } ] }
```

### `POST /api/v1/import/run`

Transfer the volume's NEFs (+ `.xmp` sidecars) to `destination`, then eject.
Skips files already present in the destination (never overwrites); ejects only
after a zero-error transfer. Emits `import-progress` over the WebSocket.

**Request:**
```json
{ "volume_mount": "/Volumes/NIKON Z 9", "destination": "~/Pictures/nerladdat", "mode": "move", "eject": true }
```
`mode` is `move` (default) or `copy`.

**Response:**
```json
{ "transferred": ["…/DSC0001.NEF"], "skipped": [{"path":"…","reason":"finns redan i målmappen"}], "errors": [], "ejected": true, "total": 312 }
```

WebSocket event `import-progress`: `{ "phase": "transfer", "current": 5, "total": 312, "file": "DSC0005.NEF", "percent": 2 }`.

---

## Rename NEF

EXIF-based NEF renaming (`YYMMDD_HHMMSS.NEF`) with preview/confirm. Backs the
**Byt namn** module. Requires `exiftool`.

### `POST /api/v1/rename-nef/preview`

Dry-run: resolve NEFs (folder/glob) and return the EXIF-derived rename mapping.
Request `{ roots, globs, recursive }`.

**Response:**
```json
{
  "items": [ { "original_path": "…/DSC0001.NEF", "original": "DSC0001.NEF", "new_name": "250601_100000.NEF" } ],
  "total_files": 12, "to_rename": 10, "already_named": 1, "no_date": ["DSC9999.NEF"]
}
```
`no_date` = files without a usable `CreateDate` (never renamed). Identical
timestamps are disambiguated with `-NN`.

### `POST /api/v1/rename-nef/execute`

Rename the NEFs (+ `.xmp` sidecars) from EXIF. Recomputes from current EXIF (no
stale plan); two-pass via temp files; **never overwrites** — on a target-name
collision the original is restored and reported as skipped.

**Response:** `{ "renamed": [{"from":"DSC0001.NEF","to":"250601_100000.NEF"}], "skipped": [{"path":"…","reason":"…"}], "errors": [] }`.

`400` if no input or exiftool is missing.

---

## WebSocket

### `ws://127.0.0.1:5001/ws/progress`

Real-time progress updates during processing.

**Events:**

| Event | Data | Description |
|-------|------|-------------|
| `connected` | `{ clientId }` | Connection established |
| `progress` | `{ current, total, file }` | Processing progress |
| `face-detected` | `{ file, faces }` | Face detected |
| `complete` | `{ filesProcessed }` | Batch complete |
| `error` | `{ message }` | Processing error |

**Example client:**
```javascript
const ws = new WebSocket('ws://127.0.0.1:5001/ws/progress');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  switch (data.type) {
    case 'progress':
      console.log(`${data.current}/${data.total}`);
      break;
    case 'face-detected':
      console.log(`Found ${data.faces.length} faces`);
      break;
  }
};
```

---

## Error Responses

All endpoints return errors in this format:

```json
{
  "detail": "Error message",
  "status": "error"
}
```

Common HTTP status codes:
- `400` - Bad request (invalid parameters)
- `404` - Not found (file or person doesn't exist)
- `500` - Internal server error
