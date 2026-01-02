# Workspace-guide

Guide för att använda det grafiska gränssnittet.

---

## Översikt

Workspace är ett modulärt gränssnitt byggt med FlexLayout. Paneler kan dockas, flyttas och storleksändras fritt.

### Moduler

| Modul | Beskrivning |
|-------|-------------|
| **Image Viewer** | Visar bilder med zoom och panorering |
| **Face Review** | Granska och bekräfta ansikten |
| **File Queue** | Hantera filkön |
| **Log Viewer** | Visa loggar |
| **Original View** | Jämför med originalfil |
| **Statistics** | Bearbetningsstatistik |
| **Database** | Databashantering |
| **Preferences** | Inställningar |
| **Theme Editor** | Anpassa utseende |

---

## Tangentbordsgenvägar

### Navigation

| Genväg | Funktion |
|--------|----------|
| `Cmd+←→↑↓` | Flytta fokus mellan paneler |
| `Tab` | Nästa ansikte/fält |
| `Shift+Tab` | Föregående ansikte/fält |

### Bildvisning

| Genväg | Funktion |
|--------|----------|
| `+` / `-` | Zooma in/ut (håll för kontinuerlig) |
| `=` | Återställ till 1:1 |
| `0` | Auto-anpassa till fönster |
| `B` | Visa/dölj bounding boxes |
| `b` | Växla enstaka/alla boxar |
| `c` / `C` | Aktivera/avaktivera auto-centrering |

### Ansiktsgranskning

| Genväg | Funktion |
|--------|----------|
| `Enter` / `A` | Acceptera föreslagen matchning |
| `I` | Ignorera ansikte |
| `R` | Byt namn / ange namn |
| `1-9` | Välj matchningsalternativ |
| `↑` / `↓` | Föregående/nästa ansikte |
| `X` | Hoppa till nästa fil |
| `Esc` | Avbryt ändringar |

### Layout

| Genväg | Funktion |
|--------|----------|
| `Cmd+1` | Review Mode |
| `Cmd+2` | Comparison Mode |
| `Cmd+3` | Full Image |
| `Cmd+4` | Statistics Mode |
| `Cmd+5` | Queue Review Mode |
| `Cmd+Shift+]` | Lägg till kolumn |
| `Cmd+Shift+[` | Ta bort kolumn |

### Allmänt

| Genväg | Funktion |
|--------|----------|
| `?` | Visa hjälp |
| `Cmd+O` | Öppna fil |
| `Cmd+,` | Inställningar |
| `Cmd+S` | Spara ändringar |

---

## Arbetsflöde

### 1. Lägg till filer

1. Klicka `+` i File Queue eller `Cmd+O`
2. Välj en eller flera NEF-filer
3. Filer läggs till i kön

### 2. Granska ansikten

1. Klicka på en fil i kön för att ladda den
2. Ansikten visas i Face Review-panelen
3. För varje ansikte:
   - **Acceptera** (`A`/`Enter`) om matchningen är korrekt
   - **Ignorera** (`I`) om ansiktet ska ignoreras
   - **Namnge** (`R` eller skriv i fältet) för nytt namn
   - **Välj alternativ** (`1-9`) för annan matchning

### 3. Spara och fortsätt

1. När alla ansikten är granskade:
   - Auto-advance går till nästa fil (om aktiverat)
   - Eller klicka **Skip** för att hoppa vidare
2. Ändringar sparas automatiskt

### 4. Byt namn (valfritt)

1. När filer är granskade, klicka **Rename** i File Queue
2. Bekräfta namnbytet
3. Filer får nya namn enligt mönstret `YYMMDD_HHMMSS_Namn1,_Namn2.NEF`

---

## Inställningar

Öppna med `Cmd+,` eller via menyn.

### Kategorier

- **General** - Backend, tema, standardlayout
- **Layout** - Layoutmallar och rutnät
- **Image Viewer** - Zoom, panorering
- **Review** - Auto-save, bekräftelser, antal alternativ
- **Files** - Kö, namnbyte
- **Preprocessing** - Bakgrundsbearbetning, cache
- **Dashboard** - Statistiksektioner
- **Advanced** - Loggning, debug-kategorier

---

## Tema

Välj tema i General-inställningar eller via Theme Editor (`Cmd+Shift+T`):

- **Light** (Terminal Beige) - Ljust retro-tema
- **Dark** (CRT Phosphor) - Mörkt CRT-tema
- **System** - Följer systemets inställning

Theme Editor ger full kontroll över färger och presets.

---

## Tips

1. **Snabb granskning**: Använd `1-9` för att snabbt välja matchningsalternativ
2. **Batch-läge**: Aktivera auto-advance för snabbare genomgång
3. **Fix-läge**: Aktivera för att omgranska redan bearbetade filer
4. **Ångra**: Använd Database-modulen för att ångra filändringar
