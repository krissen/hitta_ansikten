# API Reference

REST and WebSocket API for the Hitta ansikten backend.

---

## Overview

- **Base URL**: `http://127.0.0.1:5001/api`
- **WebSocket**: `ws://127.0.0.1:5001/ws/progress`
- **Format**: JSON

---

## Health Check

### `GET /health`

Check backend status.

**Response:**
```json
{
  "status": "ok",
  "service": "bildvisare-backend"
}
```

---

## Face Detection

### `POST /api/detect-faces`

Detect faces in an image.

**Request:**
```json
{
  "imagePath": "/path/to/image.NEF",
  "maxAlternatives": 5
}
```

**Response:**
```json
{
  "status": "completed",
  "faces": [
    {
      "bbox": { "x": 100, "y": 150, "width": 200, "height": 200 },
      "personName": "Anna",
      "confidence": 0.85,
      "alternatives": [
        { "name": "Anna", "distance": 0.35 },
        { "name": "Bert", "distance": 0.52 }
      ]
    }
  ],
  "imagePath": "/path/to/image.NEF"
}
```

### `GET /api/face-thumbnail`

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

### `POST /api/confirm-identity`

Confirm face identity and save to database.

**Request:**
```json
{
  "imagePath": "/path/to/image.NEF",
  "faceIndex": 0,
  "personName": "Anna",
  "bbox": { "x": 100, "y": 150, "width": 200, "height": 200 }
}
```

**Response:**
```json
{
  "status": "ok",
  "message": "Identity confirmed for Anna"
}
```

### `POST /api/ignore-face`

Mark face as ignored.

**Request:**
```json
{
  "imagePath": "/path/to/image.NEF",
  "faceIndex": 0,
  "bbox": { "x": 100, "y": 150, "width": 200, "height": 200 }
}
```

### `POST /api/mark-review-complete`

Mark file review as complete, log to attempt_stats.

**Request:**
```json
{
  "imagePath": "/path/to/image.NEF",
  "faces": [
    { "name": "Anna", "action": "confirmed" },
    { "name": null, "action": "ignored" }
  ]
}
```

### `POST /api/reload-database`

Reload face database from disk.

**Response:**
```json
{
  "status": "ok",
  "peopleCount": 42,
  "encodingsCount": 156
}
```

---

## Database

### `GET /api/database/people`

Get all people with encoding counts.

**Response:**
```json
[
  { "name": "Anna", "encodingCount": 12 },
  { "name": "Bert", "encodingCount": 8 }
]
```

### `GET /api/database/people/names`

Get list of person names (for autocomplete).

**Response:**
```json
["Anna", "Bert", "Carl"]
```

---

## Statistics

### `GET /api/statistics/summary`

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

### `GET /api/statistics/attempt-stats`

Get attempt statistics table.

### `GET /api/statistics/top-faces`

Get top faces by encoding count.

### `GET /api/statistics/recent-images`

Get recently processed images.

**Query:** `?n=3` (default: 3)

### `GET /api/statistics/recent-logs`

Get recent log entries.

**Query:** `?n=3` (default: 3)

### `GET /api/statistics/processed-files`

Get processed files list.

**Query:** `?n=200&source=cli`

---

## Management

### `GET /api/management/stats`

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

### `GET /api/management/database-state`

Get current database state.

### `POST /api/management/rename-person`

Rename person in database.

**Request:**
```json
{
  "oldName": "Anna",
  "newName": "Anna S"
}
```

### `POST /api/management/merge-people`

Merge multiple people into target.

**Request:**
```json
{
  "sourceNames": ["Anna", "Anna S"],
  "targetName": "Anna Svensson"
}
```

### `DELETE /api/management/delete-person`

Delete person from database.

**Request:**
```json
{
  "name": "Unknown"
}
```

### `POST /api/management/move-to-ignore`

Move person's encodings to ignored list.

**Request:**
```json
{
  "name": "Unknown"
}
```

### `POST /api/management/move-from-ignore`

Move encodings from ignored to person.

**Request:**
```json
{
  "name": "Anna",
  "count": 5
}
```

### `POST /api/management/undo-file`

Undo processing for files matching pattern.

**Request:**
```json
{
  "pattern": "250101_*"
}
```

### `POST /api/management/purge-encodings`

Remove last X encodings from person.

**Request:**
```json
{
  "name": "Anna",
  "count": 3
}
```

### `GET /api/management/recent-files`

Get last N processed files.

**Query:** `?n=10` (default: 10)

---

## Preprocessing

### `GET /api/preprocessing/cache/status`

Get cache status.

**Response:**
```json
{
  "enabled": true,
  "entryCount": 42,
  "sizeBytes": 1234567
}
```

### `POST /api/preprocessing/cache/settings`

Update cache settings.

### `DELETE /api/preprocessing/cache`

Clear all cache entries.

### `DELETE /api/preprocessing/cache/{file_hash}`

Remove specific cache entry.

### `POST /api/preprocessing/hash`

Compute SHA1 hash of file.

**Request:**
```json
{
  "file_path": "/path/to/image.NEF"
}
```

### `POST /api/preprocessing/check`

Check what's cached for a file.

### `POST /api/preprocessing/nef`

Convert NEF to JPG with caching.

**Request:**
```json
{
  "file_path": "/path/to/image.NEF",
  "force": false
}
```

### `POST /api/preprocessing/faces`

Detect faces with caching.

### `POST /api/preprocessing/thumbnails`

Generate face thumbnails with caching.

### `POST /api/preprocessing/all`

Run all preprocessing steps.

---

## Files

### `GET /api/files/rename-config`

Get rename configuration and presets.

### `POST /api/files/rename-preview`

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

### `POST /api/files/rename`

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
