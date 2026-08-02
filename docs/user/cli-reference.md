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

> **Arkiverat verktyg.** Ligger i `backend/scripts/archive/` och används inte av
> GUI:t. Kör från `backend/`: `python scripts/archive/hantera_ansikten.py`.

Interaktiv databashantering.

```bash
python scripts/archive/hantera_ansikten.py
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

> **Arkiverat verktyg.** Ligger i `backend/scripts/archive/` och används inte av
> GUI:t. Kör från `backend/`: `python scripts/archive/analysera_ansikten.py`.

Statistik och analys.

```bash
python scripts/archive/analysera_ansikten.py
```

Visar:
- Antal unika personer
- Antal encodings per person
- Bearbetningshistorik
- Träffstatistik

---

## rakna_spelare.py

Räknar bilder per person och visar statistik för att identifiera över-/underrepresenterade spelare.

### Grundläggande användning

```bash
# Räkna bilder i en match
./rakna_spelare.py "260104*.jpg"

# Visa per match-statistik
./rakna_spelare.py --per-match "*.jpg"

# Använd mean istället för median
./rakna_spelare.py --baseline mean "*.jpg"

# Längre gap mellan matcher (45 min)
./rakna_spelare.py --gap-minutes 45 "*.jpg"
```

### Flaggor

| Flagga | Standard | Beskrivning |
|--------|----------|-------------|
| `--baseline {median,mean}` | `median` | Baseline-metod för deviation |
| `--min-images N` | `3` | Minsta antal bilder för baseline |
| `-p, --per-match` | - | Visa resultat per match |
| `-g, --gap-minutes N` | `30` | Minuter mellan matcher |
| `--tranare "A,B"` | - | Ersätt tränare-listan |
| `--add-tranare "X"` | - | Lägg till tränare |
| `--publik "A,B"` | - | Ersätt publik-listan |
| `--add-publik "X"` | - | Lägg till publik |
| `--no-color` | - | Stäng av färger |
| `--ascii` | - | Endast ASCII-tecken |

### Konfiguration

Config-fil: `~/.local/share/faceid/rakna_spelare.json`

```json
{
  "tranare": ["Martin", "Ronnie"],
  "publik": ["Jasenko", "Jelena"],
  "grupp": ["Reservlaget"],
  "always_grupp": ["Laget", "FBK"],
  "always_publik": ["Klacken"]
}
```

`always_grupp`/`always_publik` är markörer som alltid räknas som gruppbilder/
publik oavsett tröskel. De är valfria — utelämnade används de inbyggda
standardvärdena (`Laget`/`FBK` respektive `Klacken`), så befintliga configar är
oförändrade. Ange dem för att lägga till egna (t.ex. `Forward`) eller ta bort en
inbyggd; en tom lista nollställer den alltid-uteslutna uppsättningen.

Miljövariabler: `RAKNA_TRANARE`, `RAKNA_PUBLIK`, `RAKNA_GRUPP`,
`RAKNA_ALWAYS_GRUPP`, `RAKNA_ALWAYS_PUBLIK`, `NO_COLOR`

**Prioritet:** CLI-flaggor > miljövariabler > config-fil > standardvärden

**Alltid exkluderade markörer:** `Laget` och `FBK` räknas alltid som gruppbilder
(lagbilder) och `Klacken` alltid som publik — de behandlas inte som spelare
oavsett antal eller config. Dessa läggs alltid till utöver eventuella egna
namn i `grupp`/`publik`. Gäller både CLI och GUI (Räkna spelare / Gallra spelare).

### Output

```
=== Totalt (12:01 → 14:27, 146 min) ===
Bilder: 155   Spelare: 15   Baseline: median=18.0

NAMN        ANT      %      Δ%      ΔN  BAR                     SPARK
Hugo         25   16.1%   +39%    (+7)  [##############------]  ···:*·::·**:*·:*·*·:
...
Albin         8    5.2%   -56%   (-10)  [####----------------]  ····:·::···········*

--- Tränare (5 st) ---
  HenrikA: 11 (7.1%)
```

- **Δ%**: Deviation från baseline (positiv = för många, negativ = för få)
- **ΔN**: Antal bilder över/under baseline
- **BAR**: Visuell representation relativt baseline
- **SPARK**: Temporal fördelning (när bilderna togs)
- Färgkodning: OK (±10%), WARN (10-20%), HIGH/LOW (>20%)

---

## Arkiverade verktyg

> Följande fristående legacy- och engångsverktyg ligger i
> `backend/scripts/archive/` och används inte av GUI:t eller runtime. De körs
> från `backend/` med `python scripts/archive/<verktyg>.py` (se
> `backend/scripts/archive/README.md`).

### ratta_ansikten.py

Granska och korrigera befintliga matchningar.

```bash
python scripts/archive/ratta_ansikten.py
```

### forfina_ansikten.py

Förfina ansiktsdetekteringar (justera bounding boxes).

```bash
python scripts/archive/forfina_ansikten.py
```

### update_encodings_with_filehash.py

Migrera äldre encodings till nytt format med filhashar.

```bash
python scripts/archive/update_encodings_with_filehash.py 2024*.NEF
```

### rensa_dlib.py

Ta bort alla dlib-encodings från databasen. dlib är deprecated.

```bash
# Förhandsgranska
python scripts/archive/rensa_dlib.py --dry-run

# Utför borttagning
python scripts/archive/rensa_dlib.py
```

---

## Övriga verktyg

### filer2mappar.py

Flytta filer till undermappar baserat på datum (YYMMDD).

```bash
# Flytta NEF-filer till datummappar
./filer2mappar.py *.NEF

# Förhandsgranska
./filer2mappar.py --dry-run *.NEF

# Använd EXIF-datum istället för filnamn
./filer2mappar.py --exif-date *.NEF

# Filtrera på datum
./filer2mappar.py --from 260101 --to 260131 *.NEF
```

#### Matcha framkallade bilder mot källmappar

Underkommandot `matcha-kalla` fördelar stödda bildfiler från roten av
`~/Pictures/framkallat` till samma relativa mappar som motsvarande källbilder
har under `~/Pictures/nerladdat`. Matchningen använder den inledande
tidsstämpeln `YYMMDD_HHMMSS`; text och filändelse efter tidsstämpeln får skilja
sig. Källan kan vara valfritt stött bildformat, exempelvis NEF, JPG eller TIFF.

```bash
# Förhandsgranska den normala arbetsgången
filer2mappar matcha-kalla --dry-run

# Flytta alla entydiga träffar
filer2mappar matcha-kalla

# Verkställ även redovisade kvalificerade gissningar
filer2mappar matcha-kalla --flytta-osakra

# Använd ett större tidsfönster eller andra katalogrötter
filer2mappar matcha-kalla --tidsfonster 60
filer2mappar matcha-kalla --kallrot /sökväg/källor --malrot /sökväg/framkallat
```

En gissning görs bara när närmaste källbild ligger inom tidsfönstret och både
närmast föregående och efterföljande exakt matchbara framkallade bild pekar på
samma källmapp. Standardfönstret är 30 minuter. Gissningar visas men lämnas
kvar i roten tills `--flytta-osakra` anges. Olösta filer lämnas alltid orörda.

| Flagga | Beskrivning |
|--------|-------------|
| `--kallrot SÖKVÄG` | Källträd; normalt `~/Pictures/nerladdat` |
| `--malrot SÖKVÄG` | Rot för framkallade bilder; normalt `~/Pictures/framkallat` |
| `--flytta-osakra` | Verkställ även kvalificerade gissningar |
| `--tidsfonster MINUTER` | Maximalt tidsavstånd för gissningar; normalt 30 |

| Flagga | Beskrivning |
|--------|-------------|
| `-n, --dry-run` | Visa vad som skulle göras |
| `-v, --verbose` | Visa varje flytt |
| `--exif-date` | Använd EXIF CreateDate |
| `--file-date` | Använd filens modifieringsdatum |
| `--before DATUM` | Före datum (exklusivt) |
| `--after DATUM` | Efter datum (exklusivt) |
| `--from DATUM` | Från och med datum |
| `--to DATUM` | Till och med datum |
| `--no-sidecars` | Flytta inte .xmp automatiskt |

### rename_nef.py

Döp om NEF-filer baserat på EXIF CreateDate.

```bash
# Döp om filer till YYMMDD_HHMMSS.NEF
./rename_nef.py *.NEF

# Förhandsgranska
./rename_nef.py --dry-run *.NEF
```

Filer med samma tidsstämpel får suffix: `-00`, `-01`, etc.

---

## Konfiguration

Inställningar i `~/.local/share/faceid/config.json`:

```json
{
  "detection_model": "hog",
  "backend": {
    "type": "insightface"
  },
  "backend_thresholds": {
    "insightface": {
      "match_threshold": 0.45,
      "ignore_distance": 0.35,
      "hard_negative_distance": 0.32
    }
  }
}
```

### Viktiga inställningar

| Nyckel | Standard | Beskrivning |
|--------|----------|-------------|
| `detection_model` | `"hog"` | `"hog"` (snabb) eller `"cnn"` (noggrann) |
| `backend.type` | `"insightface"` | InsightFace (512-dim, cosine distance) |
| `backend_thresholds.<backend>.match_threshold` | `0.45` (insightface) | Tröskel för matchning (lägre = striktare). Höjd 0,40 → 0,45 i ansiktsigenkänningsauditen (2026-07). Enda sanningskällan — de gamla platta nycklarna `match_threshold`/`ignore_distance` används inte längre (fel distansmetrik) och migreras bort vid laddning. |
| `auto_ignore` | `false` | Auto-ignorera omatchade ansikten |
| `image_viewer_app` | `"Ansikten"` | Extern app för förhandsvisning |

> **Not:** dlib-backend är deprecated sedan januari 2026. Om du har äldre dlib-encodings, använd `scripts/archive/rensa_dlib.py` eller RefineFaces-modulen i GUI:t för att ta bort dem.

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
