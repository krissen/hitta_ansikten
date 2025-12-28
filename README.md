# hitta_ansikten

**hitta_ansikten** är ett monorepo med verktyg för ansiktsdetektering och bildvisning:

- **Backend**: Python-baserat terminalverktyg + FastAPI server för ansiktsdetektering och igenkänning i stora samlingar av RAW-bilder (NEF från Nikon)
- **Frontend**: Modular workspace (Bildvisare) - GIMP-liknande dockbar panellayout för bildgranskning, annotation och real-time kommunikation med backend
- **Shared**: Delade typdefinitioner och API-protokoll mellan frontend och backend

Projektet är särskilt utformat för att underlätta identifiering, omdöpning och annotering av bilder från sportevent, skolaktiviteter eller andra miljöer där många personer återkommer på flera bilder.

**Status:** Backend CLI funktionell. Frontend workspace (Fas 1-3) implementerad med mock data. Nästa steg: integrera riktig ansiktsdetektering.

## Projektstruktur

```
hitta_ansikten/
├── backend/           # Python ML backend för ansiktsdetektering
├── frontend/          # Electron bildvisare (Bildvisare)
├── shared/            # Delade typer och API-protokoll
├── README.md          # Denna fil
└── LICENSE
```

## Syfte och bakgrund

Verktyget löser ett konkret problem: att snabbt och halvautomatiskt sortera, namnge och strukturera tusentals bilder utifrån vilka personer som faktiskt förekommer på bilderna. Resultatet är ett effektivt arbetsflöde där varje bild får ett informativt filnamn och all information om ansikten och matchningar sparas för framtida batchbearbetningar.

Projektet har utvecklats med följande mål:

- **Effektiv batchhantering:** Byggd för att köra på kataloger med hundratals eller tusentals RAW-filer.
- **Terminalbaserad granskning:** Ingen webbtjänst eller GUI krävs; alla steg sköts i terminalen med stöd för tangentbordsnavigering, autocomplete mm.
- **Interaktiv review:** Osäkra matchningar och nya ansikten hanteras via dialog där användaren kan bekräfta, ignorera, rätta eller lägga till personer manuellt.
- **Robust datalagring:** Matchningar och encodings sparas i persistenta filer (pickle, jsonl) så att projektet kan återupptas eller utökas i efterhand.

## Funktionalitet

- **Batch-detektion av ansikten** i RAW-filer (NEF) med `face_recognition` (dlib).
- **Igenkänning** mot existerande databas av kända personer ("encodings").
- **Terminalinteraktion** där användaren bekräftar, rättar eller ignorerar föreslagna matchningar – eller manuellt anger namn där ansiktet inte kan detekteras (t.ex. ryggar eller suddiga bilder).
- **Automatisk omdöpning av filer** enligt vilka personer som identifierats.
- **Stöd för parallellbearbetning** med multiprocessing.
- **Persistenta databaser** för ansiktsigenkänning, ignoreringar, metadata, processade filer och attempt-loggar.
- **Flexibel, framtidssäkrad kodbas** med stöd för migrering av äldre databasformat.

## Databasfiler och struktur

Alla data sparas i en katalog under `~/.local/share/faceid/` (justerbart):

| Filnamn                  | Syfte |
|--------------------------|-------|
| `encodings.pkl`          | Dict med kända ansikten, inkl. encodings, filnamn och filhashar. |
| `ignored.pkl`            | Lista med ignorerade ansikts-encodings. |
| `processed_files.jsonl`  | JSON-lines-lista över processade filer (filnamn och hash). |
| `attempt_stats.jsonl`    | Logg med detaljer om alla process-försök, labels mm. |
| `metadata.json`          | Metadata om bearbetning (ex. versionsinfo). |
| `archive/`               | Arkiv med äldre/backup-loggar. |

## Arbetsflöde (CLI)

Alla backend-kommandon körs från `backend/`-katalogen:

```sh
cd backend
```

1. **Detektera och processa bilder:** `./hitta_ansikten.py 2024*.NEF`

2. **Omdöp alla redan processade bilder enligt personer:** `./hitta_ansikten.py --rename .`

3. **Bearbeta endast vissa filer (t.ex. via glob):** `./hitta_ansikten.py --rename 250518_*.NEF`

4. **Lägg till personer manuellt** (vid t.ex. ryggar eller okända ansikten) via alternativet `m` i review-dialogen.

5. **Fixa encodings eller rensa gamla matchningar:** `./hitta_ansikten.py --fix <filer>`

6. **Migrera eller uppdatera encodings med filhash:** `python update_encodings_with_filehash.py 2024*.NEF`

## Teknik

- Python 3.9+
- [face_recognition](https://github.com/ageitgey/face_recognition) (dlib)
- NumPy, Pillow, prompt_toolkit (för terminal-autocomplete)
- Multiprocessing, pickle, JSON, pathlib

## Datamodell (exempel)

```python
known_faces = {
    "Anna Andersson": [
         {"encoding": np.ndarray, "file": "2024-01-02_Anna.NEF", "hash": "a1b2c3..."},
         # ...
        ],
# ...
}```

## Installation

### Backend (Python)

Python 3.9 or newer is required.

Install all dependencies with:

```sh
cd backend
pip install -r requirements.txt
```

Make sure you have Python development headers installed, as some libraries (such as dlib/face_recognition) require compilation.

### Frontend (Electron)

Node.js and npm are required.

```sh
cd frontend
npm install
```

To run the frontend:
```sh
npm start
# or
npx electron .
```

## Frontend (Bildvisare Workspace)

Modular workspace med dockbara paneler för interaktiv bildgranskning:

### Moduler
- **Image Viewer**: Canvas-baserad bildvisning med zoom/pan (stödjer NEF auto-konvertering)
- **Review Module**: UI för att granska detekterade ansikten, bekräfta/avvisa identiteter
- **Log Viewer**: Real-time loggar från backend + frontend
- **Original View**: Jämför original NEF bredvid processad bild

### Köra workspace

```bash
cd frontend
BILDVISARE_WORKSPACE=1 npx electron .
```

Backend startar automatiskt på `http://127.0.0.1:5000`

### Arkitektur
- **Dockview-core**: Panel management
- **FastAPI + WebSocket**: Backend kommunikation
- **ModuleAPI**: Inter-modul events (`image-loaded`, `sync-view`, etc.)
- **Layout persistence**: Sparas i localStorage

**För implementation-detaljer:** Se `SESSION_SUMMARY.md` (lokal fil), `CLAUDE.md` och roadmap i `~/.claude/plans/`

**Notering**: En fristående version finns också på [github.com/krissen/bildvisare](https://github.com/krissen/bildvisare)

## Preprocessed cache

Intermediate preprocessing results are written as pickled files under `preprocessed_cache/` with their labeled preview images. The program reloads any cached entries into the preprocessing queue on startup so an interrupted run can resume. Cache files and previews are deleted once the main loop consumes an entry.
