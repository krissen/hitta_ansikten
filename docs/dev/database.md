# Database

Data files and formats used by Hitta ansikten.

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
| `metadata.json` | JSON | Version and migration info |
| `config.json` | JSON | User configuration |
| `hitta_ansikten.log` | text | Debug/error log |

---

## File Formats

### encodings.pkl

Known faces database. Dictionary mapping person names to encoding lists.

```python
{
    "Anna": [
        {
            "encoding": np.ndarray,    # 128-dim (dlib) or 512-dim (InsightFace)
            "file": "250101_120000.NEF",
            "hash": "abc123...",       # SHA1 hash of source file
            "backend": "insightface",  # or "dlib"
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
- Encodings are only compared against same backend type
- Legacy entries (bare numpy arrays) auto-migrate to dict format
- One person can have multiple encodings from different images

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

### metadata.json

Version and migration metadata.

```json
{
    "version": "2.0",
    "last_migration": "2025-01-01T12:00:00",
    "backend": "insightface"
}
```

### config.json

User configuration overrides.

```json
{
    "detection_model": "hog",
    "backend": {
        "type": "insightface",
        "insightface": {
            "model_name": "buffalo_l",
            "ctx_id": -1
        }
    },
    "match_threshold": 0.4,
    "auto_ignore": false,
    "auto_ignore_on_fix": true,
    "max_downsample_px": 2800,
    "max_midsample_px": 4500,
    "max_fullres_px": 8000,
    "image_viewer_app": "Bildvisare"
}
```

**Key settings:**

| Key | Default | Description |
|-----|---------|-------------|
| `detection_model` | `"hog"` | `"hog"` (fast) or `"cnn"` (accurate) |
| `backend.type` | `"dlib"` | `"dlib"` or `"insightface"` |
| `match_threshold` | `0.54` | Distance threshold for matches |
| `auto_ignore` | `false` | Auto-ignore unmatched faces |
| `image_viewer_app` | `"Bildvisare"` | External preview app |

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

### Load Database

```python
from faceid_db import load_database

known_faces, ignored, processed, stats = load_database()
```

### Save Encoding

```python
from faceid_db import save_encoding

save_encoding(
    name="Anna",
    encoding=face_encoding,
    file_path="/path/to/image.NEF",
    file_hash="abc123...",
    backend="insightface"
)
```

### Check if Processed

```python
from faceid_db import is_processed

if is_processed(file_hash):
    print("Already processed")
```

### Mark as Processed

```python
from faceid_db import mark_processed

mark_processed(filename, file_hash)
```

---

## Migration

### Legacy Formats

Old encodings (bare numpy arrays) automatically migrate:

```python
# Old format
{"Anna": [np.array([...]), np.array([...])]}

# New format (auto-migrated)
{"Anna": [
    {"encoding": np.array([...]), "backend": "dlib", ...},
    {"encoding": np.array([...]), "backend": "dlib", ...}
]}
```

### Migration Scripts

- `migrera_processed.py` - Migrate processed_files format
- `update_encodings_with_filehash.py` - Add file hashes to old encodings

---

## Backup

Recommend backing up `~/.local/share/faceid/` regularly:

```bash
# Create backup
tar -czvf faceid-backup-$(date +%Y%m%d).tar.gz ~/.local/share/faceid/

# Restore
tar -xzvf faceid-backup-20250101.tar.gz -C ~/
```
