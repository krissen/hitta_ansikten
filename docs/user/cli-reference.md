# CLI-referens

Kommandoreferens för `hitta_ansikten.py` och relaterade verktyg.

---

## hitta_ansikten.py

Huvudverktyget för ansiktsigenkänning.

### Grundläggande användning

```bash
# Bearbeta nya bilder
./hitta_ansikten.py 2024*.NEF

# Bearbeta och byt namn direkt
./hitta_ansikten.py --rename 2024*.NEF

# Byt namn på redan bearbetade filer
./hitta_ansikten.py --rename --processed .

# Simulera namnbyte (dry-run)
./hitta_ansikten.py --rename --simulate *.NEF

# Ombearbeta specifik fil
./hitta_ansikten.py --fix 250612_153040.NEF

# Arkivera statistik
./hitta_ansikten.py --archive
```

### Flaggor

| Flagga | Beskrivning |
|--------|-------------|
| `--rename` | Byt namn efter bearbetning |
| `--processed` | Inkludera redan bearbetade filer |
| `--simulate` | Visa vad som skulle hända utan att göra det |
| `--fix <fil>` | Ombearbeta och ersätt resultat för specifik fil |
| `--archive` | Arkivera bearbetningsstatistik |
| `--help` | Visa hjälp |

---

## hantera_ansikten.py

Interaktiv databashantering.

```bash
./hantera_ansikten.py
```

### Menyalternativ

1. **Byt namn på person** - Ändra namn på person i databasen
2. **Slå samman personer** - Kombinera två personer till en
3. **Ta bort person** - Radera person från databasen
4. **Flytta till ignorerade** - Markera som ignorerat ansikte
5. **Flytta från ignorerade** - Återställ ignorerat ansikte
6. **Visa statistik** - Översikt av databasen
7. **Senaste filer** - Lista senast bearbetade filer
8. **Ångra fil** - Återställ bearbetning för fil(er)
9. **Rensa encodings** - Ta bort gamla/oanvända encodings

---

## analysera_ansikten.py

Statistik och analys.

```bash
./analysera_ansikten.py
```

Visar:
- Antal unika personer
- Antal encodings per person
- Bearbetningshistorik
- Träffstatistik

---

## Övriga verktyg

### ratta_ansikten.py

Granska och korrigera befintliga matchningar.

```bash
./ratta_ansikten.py
```

### forfina_ansikten.py

Förfina ansiktsdetekteringar (justera bounding boxes).

```bash
./forfina_ansikten.py
```

### update_encodings_with_filehash.py

Migrera äldre encodings till nytt format med filhashar.

```bash
python update_encodings_with_filehash.py 2024*.NEF
```

---

## Konfiguration

Inställningar i `~/.local/share/faceid/config.json`:

```json
{
  "detection_model": "hog",
  "match_threshold": 0.54,
  "backend": {
    "type": "dlib"
  }
}
```

### Viktiga inställningar

| Nyckel | Standard | Beskrivning |
|--------|----------|-------------|
| `detection_model` | `"hog"` | `"hog"` (snabb) eller `"cnn"` (noggrann) |
| `match_threshold` | `0.54` | Tröskel för matchning (lägre = striktare) |
| `backend.type` | `"dlib"` | `"dlib"` eller `"insightface"` |
| `auto_ignore` | `false` | Auto-ignorera omatchade ansikten |
| `image_viewer_app` | `"Bildvisare"` | Extern app för förhandsvisning |

---

## Filnamnskonventioner

Format: `YYMMDD_HHMMSS[-N][_names].NEF`

- `YYMMDD_HHMMSS` - Datum och tid
- `-N` - Sekvensnummer för burst
- `_names` - Personnamn separerade med `,_`

Exempel:
```
250612_153040.NEF                    # Original
250612_153040_Anna,_Bert.NEF         # Efter namnbyte
250612_153040-2_Anna.NEF             # Burst-sekvens
```
