# TODO - Code Review Findings

Code review conducted: 2025-12-27

## 🔴 CRITICAL SEVERITY

### 1. Race Condition: Database Writes Without Locking
**Location:** `faceid_db.py:save_database()`, `hitta_ansikten.py` (lines 2051, 2228, 2284)
**Risk:** Data corruption, lost updates

Multiple processes can call `save_database()` concurrently without synchronization. No file locking when reading/writing pickle files.

**Fix:**
```python
import fcntl

def save_database(known_faces, ignored_faces, hard_negatives, processed_files):
    ENCODING_PATH.parent.mkdir(parents=True, exist_ok=True)

    # Atomic write: temp file + rename
    temp_encoding = ENCODING_PATH.with_suffix('.tmp')
    with open(temp_encoding, "wb") as f:
        fcntl.flock(f.fileno(), fcntl.LOCK_EX)
        pickle.dump(known_faces, f)
    temp_encoding.replace(ENCODING_PATH)
    # Similar for other files...
```

---

### 2. Pickle Security Vulnerability
**Location:** `faceid_db.py:87-105`, `hitta_ansikten.py:1849`, multiple helper scripts
**Risk:** Arbitrary code execution

Unrestricted `pickle.load()` on user-controlled files. Malicious pickle can execute arbitrary code.

**Fix:**
```python
class RestrictedUnpickler(pickle.Unpickler):
    def find_class(self, module, name):
        # Only allow safe classes
        if module == "numpy" and name in ("ndarray", "dtype"):
            return getattr(__import__(module, fromlist=[name]), name)
        if module == "builtins" and name in ("dict", "list", "tuple", "str", "int", "float", "bool"):
            return getattr(__import__(module, fromlist=[name]), name)
        raise pickle.UnpicklingError(f"Forbidden class: {module}.{name}")

def safe_load(file_path):
    with open(file_path, "rb") as f:
        return RestrictedUnpickler(f).load()
```

**Alternative:** Migrate to JSON/MessagePack + separate .npy files for encodings.

---

### 3. File Existence TOCTOU (Time-of-Check-Time-of-Use)
**Location:** `hitta_ansikten.py` (lines 1318-1320, 1393-1396, 1851-1862, 2086-2089, 2109-2111, 2163-2167)
**Risk:** Program crash, cache corruption

Multiple places check `path.exists()` then operate on file without handling deletion between check and use.

**Fix:**
```python
try:
    with rawpy.imread(str(image_path)) as raw:
        rgb = raw.postprocess()
except FileNotFoundError:
    logging.warning(f"[PREPROCESS][{fname}] File deleted during processing")
    return []
except Exception as e:
    logging.error(f"[PREPROCESS][{fname}] Failed to read: {e}")
    return []
```

---

## 🟠 HIGH SEVERITY

### 4. Multiprocessing Queue Deadlock Risk
**Location:** `hitta_ansikten.py:2122-2297`
**Risk:** Program hangs indefinitely

Queue has `maxsize=max_queue`. Workers can block on `put()` if main stops consuming. No timeout on `p.join()`.

**Fix:**
```python
# Add timeout to worker join
for p in workers:
    p.join(timeout=30)
    if p.is_alive():
        logging.error(f"Worker {p.pid} did not finish, terminating")
        p.terminate()
        p.join()
```

---

### 5. Unsafe Path Construction (Path Traversal)
**Location:** `hitta_ansikten.py:1725, 1733`
**Risk:** File overwrite in arbitrary locations

```python
dest = str(Path(orig).parent / nytt)  # Line 1725
```

If `nytt` contains `../../etc/passwd`, could write outside intended directory.

**Fix:**
```python
# Sanitize filename components
safe_name = normalize_name(kort).replace('/', '_').replace('\0', '_')

# Validate no path traversal
if '..' in new_name or '/' in new_name:
    logging.error(f"Rejected unsafe filename: {new_name}")
    return None
```

---

### 6. Memory Leak: Unclosed File Handles
**Location:** `analysera_ansikten.py:29`, `ratta_ansikten.py:36`
**Risk:** Resource exhaustion

```python
for line in open(f):  # File never closed
    try:
        entry = json.loads(line)
```

**Fix:**
```python
with open(f) as file:
    for line in file:
        try:
            entry = json.loads(line)
```

---

### 7. Worker Process Error Handling Insufficient
**Location:** `hitta_ansikten.py:1943-1955`
**Risk:** Silent failures, difficult debugging

Worker catches all exceptions but only logs to file. Main process continues without knowing worker failed.

**Fix:**
```python
# Use shared error queue
error_queue = multiprocessing.Queue()

def preprocess_worker(..., error_queue):
    try:
        # ... existing code ...
    except Exception as e:
        error_queue.put((os.getpid(), type(e).__name__, str(e), traceback.format_exc()))
        raise
    finally:
        preprocess_done.set()

# In main loop, check error queue
try:
    error = error_queue.get_nowait()
    pid, etype, emsg, trace = error
    print(f"\n⚠️  Worker process crashed: {etype}: {emsg}")
except queue.Empty:
    pass
```

---

## 🟡 MEDIUM SEVERITY

### 8. Inconsistent Error Handling for Hash Encoding
**Location:** `faceid_db.py:48-51, 70-79`

`hash_encoding()` can return `None` for corrupted encodings. Code checks in some places but not others.

**Fix:** Add validation and logging:
```python
def hash_encoding(enc):
    if isinstance(enc, dict) and "encoding" in enc:
        enc = enc["encoding"]
    if enc is None:
        return None
    try:
        return hashlib.sha1(enc.tobytes()).hexdigest()
    except (AttributeError, ValueError, TypeError) as e:
        logging.error(f"Failed to hash encoding: {type(enc).__name__}: {e}")
        return None
```

---

### 9. Exception Swallowing Without Logging
**Location:** Multiple locations

Examples:
- `faceid_db.py:122-125` - Silent fallback to legacy format
- `hitta_ansikten.py:1739-1740` - Ignores cleanup failures
- `hitta_ansikten.py:1860-1861` - Ignores cache cleanup errors

**Fix:** Add logging to all exception handlers:
```python
except Exception as e:
    logging.debug(f"Non-critical error: {e}")
    pass
```

---

### 10. Hardcoded Paths
**Location:** `hitta_ansikten.py:58, 268, 276, 1433`

```python
ORDINARY_PREVIEW_PATH = "/tmp/hitta_ansikten_preview.jpg"  # Line 58
```

**Risk:** Fails on Windows, conflicts on multi-user systems

**Fix:**
```python
import tempfile
TEMP_DIR = Path(tempfile.gettempdir()) / "hitta_ansikten"
TEMP_DIR.mkdir(exist_ok=True)
ORDINARY_PREVIEW_PATH = TEMP_DIR / "preview.jpg"
```

---

### 11. Backend Mismatch Not Validated
**Location:** `hitta_ansikten.py:1086-1189`

No validation that encoding dimensions match backend expectations (Dlib=128, InsightFace=512).

**Fix:**
```python
def validate_encoding_dimension(encoding, backend):
    """Validate encoding matches backend dimension."""
    expected_dim = backend.encoding_dim
    actual_dim = len(encoding) if hasattr(encoding, '__len__') else None
    if actual_dim != expected_dim:
        logging.warning(f"Encoding dimension mismatch: expected {expected_dim}, got {actual_dim}")
        return False
    return True
```

---

### 12. Duplicate Encoding Detection Uses id() Instead of Content
**Location:** `hantera_ansikten.py:236-241`

```python
seen = set()
for enc in encodings:
    if id(enc) not in seen:  # Uses object identity, not content!
        seen.add(id(enc))
```

**Risk:** Duplicate encodings not detected, database bloat

**Fix:**
```python
seen = set()
for enc in encodings:
    if isinstance(enc, dict):
        enc_hash = enc.get('encoding_hash')
        if enc_hash and enc_hash not in seen:
            seen.add(enc_hash)
            encodings_unique.append(enc)
```

---

### 13. Inefficient Backend Filtering (Performance)
**Location:** `hitta_ansikten.py:1113-1178`

Loops through all encodings for every face match. O(n*m) for each face with large databases.

**Fix:** Build index once per backend:
```python
def build_backend_index(known_faces, backend_name):
    """Build index of encodings by backend."""
    index = {}
    for name, entries in known_faces.items():
        backend_encs = [e['encoding'] for e in entries
                       if isinstance(e, dict) and e.get('backend') == backend_name]
        if backend_encs:
            index[name] = np.array(backend_encs)
    return index
```

---

## 🟢 LOW SEVERITY

### 14. Missing Type Hints
Most functions lack type hints. Inconsistent throughout codebase.

**Fix:** Add type hints systematically, starting with public APIs.

---

### 15. Code Duplication
- Hash computation duplicated across files
- Error message patterns repeated
- Cache path construction duplicated

**Fix:** Centralize in `faceid_db.py`

---

### 16. Magic Numbers
Examples:
- `buffer = 40` (line 898)
- `max_wait = 90` (line 2232)
- `epsilon = 1e-6` (face_backends.py:342)

**Fix:** Extract to named constants at module level

---

### 17. Inconsistent Logging Levels
Important errors logged as `debug()` instead of `error()` or `warning()`:
- Line 1865: Cache failures should be warnings
- Many cache operations use debug inappropriately

---

### 18. String Formatting Inconsistency
Mix of f-strings, % formatting, and .format()

**Fix:** Standardize on f-strings throughout

---

### 19. Commented-Out Code
**Location:** `hitta_ansikten.py:287`

```python
# os.system(f"open -a '{config.get('image_viewer_app', 'Bildvisare')}' '{export_path}'")
```

**Fix:** Remove or document why it's kept

---

### 20. Long Functions
- `user_review_encodings()`: ~230 lines (634-859)
- `main()`: ~350 lines (1958-2303)
- `preprocess_worker()`: ~70 lines (1881-1955)

**Fix:** Break into smaller, focused functions

---

### 21. Unsafe Subprocess Call (Minor)
**Location:** `hitta_ansikten.py:333`

`viewer_app` from config used directly in subprocess.

**Fix:**
```python
if not viewer_app.replace(' ', '').replace('-', '').replace('_', '').isalnum():
    logging.error(f"Invalid viewer app name: {viewer_app}")
    return
```

---

### 22. Missing Documentation
Complex functions lack docstrings:
- `get_attempt_setting_defs()` (line 161)
- `collect_persons_for_files()` (line 1534)
- `resolve_fornamn_dubletter()` (line 1628)

---

### 23. Potential Unicode Issues
**Location:** `faceid_db.py:189`

File writing without explicit encoding.

**Fix:**
```python
with open(PROCESSED_PATH, "w", encoding="utf-8") as f:
```

---

## 📋 TESTING RECOMMENDATIONS

Current state: No automated tests exist.

**Priority test coverage:**
1. Unit tests for `best_matches()` with different backends
2. Unit tests for `normalize_encoding_entry()` migration
3. Integration tests for multiprocessing queue behavior
4. Test file locking mechanisms
5. Test TOCTOU scenarios (file deletion during processing)
6. Test pickle security with malicious files
7. Test path traversal prevention

---

## 🎯 IMPLEMENTATION PRIORITY

**Fix Immediately (CRITICAL - Security & Data Integrity):**
1. Add file locking to `save_database()`
2. Replace unsafe `pickle.load()` with restricted unpickler
3. Fix TOCTOU with try-except around file operations

**Fix Soon (HIGH - Stability & Reliability):**
4. Add timeout for multiprocessing joins
5. Sanitize filenames to prevent path traversal
6. Fix unclosed file handles
7. Improve worker error reporting

**Fix When Possible (MEDIUM):**
8-13. Improve error handling, validation, logging, performance

**Consider for Refactoring (LOW):**
14-23. Code quality, documentation, maintainability

---

## ✅ POSITIVE ASPECTS

The codebase demonstrates good practices:
- ✅ Good separation of concerns (backends, database, main logic)
- ✅ Comprehensive logging throughout
- ✅ Graceful degradation for missing dependencies
- ✅ XDG directory compliance
- ✅ Multiprocessing for performance
- ✅ Backward compatibility for data migration
- ✅ Comprehensive configuration system

The issues found are typical of rapidly-developed research/personal projects and can be systematically addressed.
