# Kom igång med Hitta ansikten

Guide för att installera och köra Hitta ansikten.

---

## Systemkrav

### Backend (Python)
- Python 3.9+
- dlib eller InsightFace (se nedan)
- ~2GB RAM för bearbetning
- SSD rekommenderas för cache

### Frontend (Electron)
- Node.js 18+
- npm 9+
- macOS, Linux eller Windows

---

## Installation

### 1. Klona repot

```bash
git clone https://github.com/krissen/hitta_ansikten.git
cd hitta_ansikten
```

### 2. Backend-beroenden

```bash
# Skapa virtuell miljö (rekommenderas)
python -m venv venv
source venv/bin/activate  # Linux/macOS
# eller: venv\Scripts\activate  # Windows

# Installera beroenden
pip install -r requirements.txt
```

#### Face Recognition Backend

Välj **en** av dessa:

**dlib (standard):**
```bash
pip install face_recognition
```

**InsightFace (snabbare, bättre noggrannhet):**
```bash
pip install insightface onnxruntime
```

### 3. Frontend-beroenden

```bash
cd frontend
npm install
```

---

## Första körningen

### CLI (Backend)

```bash
# Bearbeta bilder
./hitta_ansikten.py /path/to/*.NEF

# Visa hjälp
./hitta_ansikten.py --help
```

### Workspace (Frontend)

```bash
cd frontend

# Bygg och starta
npm run build:workspace
npx electron .
```

Backend-servern startar automatiskt på port 5001.

---

## Datalagring

All data sparas i `~/.local/share/faceid/`:

| Fil | Beskrivning |
|-----|-------------|
| `encodings.pkl` | Kända ansikten |
| `ignored.pkl` | Ignorerade ansikten |
| `processed_files.jsonl` | Bearbetade filer |
| `attempt_stats.jsonl` | Bearbetningshistorik |
| `config.json` | Användarinställningar |

---

## Nästa steg

- [CLI-referens](cli-reference.md) - Alla kommandon
- [Workspace-guide](workspace-guide.md) - Använda gränssnittet
