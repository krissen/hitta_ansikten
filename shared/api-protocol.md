# API Protocol

Communication protocol between frontend (Electron) and backend (Python).

## Communication Method

- **HTTP REST API** (Flask/FastAPI backend)
- **Default Port**: 5000
- **Base URL**: `http://localhost:5000/api`

## Endpoints

### Face Detection

#### `POST /api/detect-faces`
Detect faces in an image.

**Request:**
```json
{
  "imagePath": "/path/to/image.jpg",
  "autoAnnotate": true
}
```

**Response:**
```json
{
  "status": "completed",
  "faces": [
    {
      "bbox": { "x": 100, "y": 150, "width": 200, "height": 200 },
      "personName": "John Doe",
      "confidence": 0.95
    }
  ]
}
```

#### `POST /api/annotate-face`
Manual face annotation from user (when auto-detection misses a face).

**Request:**
```json
{
  "imagePath": "/path/to/image.jpg",
  "bbox": { "x": 100, "y": 150, "width": 200, "height": 200 },
  "personName": "Jane Doe"
}
```

**Response:**
```json
{
  "status": "success",
  "faceId": "abc123"
}
```

### Image Status

#### `GET /api/status/:imagePath`
Get processing status for an image.

**Response:**
```json
{
  "imagePath": "/path/to/image.jpg",
  "status": "completed",
  "facesDetected": 2,
  "timestamp": 1672531200
}
```

## WebSocket Events (Future)

For real-time updates during batch processing:

- `face-detected` - Emitted when a face is detected
- `processing-complete` - Emitted when batch processing completes
- `error` - Emitted on processing errors

## File-based Communication (Legacy)

The current status file system (`~/Library/Application Support/bildvisare/`) is deprecated in favor of HTTP API but maintained for backward compatibility.
