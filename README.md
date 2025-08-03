# hitta_ansikten

**hitta_ansikten** är ett Python-baserat terminalverktyg för batchhantering, detektering och igenkänning av ansikten i stora samlingar av RAW-bilder (t.ex. NEF från Nikon). Projektet är särskilt utformat för att underlätta identifiering, omdöpning och annotering av bilder från sportevent, skolaktiviteter eller andra miljöer där många personer återkommer på flera bilder.

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

1. **Detektera och processa bilder:** `hitta_ansikten 2024*.NEF`

2. **Omdöp alla redan processade bilder enligt personer:** `hitta_ansikten --rename .`

3. **Bearbeta endast vissa filer (t.ex. via glob):** `hitta_ansikten --rename 250518_*.NEF`

4. **Lägg till personer manuellt** (vid t.ex. ryggar eller okända ansikten) via alternativet `m` i review-dialogen.

5. **Fixa encodings eller rensa gamla matchningar:** `hitta_ansikten --fix <filer>`

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

Python 3.9 or newer is required.

Install all dependencies with:

```sh
pip install -r requirements.txt
```

Make sure you have Python development headers installed, as some libraries (such as dlib/face_recognition) require compilation.

## Companion app för bildvisning

App som används för att visa bild, taggat med labels på ansikten, är som förval kompanjon-appen [Bildvisare](https://github.com/krissen/bildvisare). Detta kan justeras i inställningar.
