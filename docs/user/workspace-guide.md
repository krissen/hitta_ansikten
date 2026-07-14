# Workspace-guide

Guide för att använda det grafiska gränssnittet.

---

## Översikt

Workspace är ett modulärt gränssnitt byggt med FlexLayout. Paneler kan dockas, flyttas och storleksändras fritt.

### Moduler

| Modul | Beskrivning |
|-------|-------------|
| **Bildvisare** | Visar bilder med zoom och panorering |
| **Granska ansikten** | Granska och bekräfta ansikten |
| **Filkö** | Hantera filkön |
| **Loggar** | Visa loggar |
| **Originalvy** | Jämför med originalfil |
| **Statistik** | Bearbetningsstatistik |
| **Importera** | Överför NEF från minneskort till målmapp och matar ut kortet |
| **Byt namn** | Byter namn på NEF efter EXIF CreateDate (YYMMDD_HHMMSS) med förhandsgranskning |
| **Räkna spelare** | Räknar bilder per spelare (från filnamn) med över-/underrepresentation |
| **Gallra spelare** | Gallra bilder per spelare med förhandsgranskning och papperskorg |
| **Papperskorg** | Visa/återställ/töm borttagna filer (Visa → Papperskorg) |
| **Databashantering** | Databashantering |
| **Inställningar** | Inställningar |
| **Temaredigerare** | Anpassa utseende |

---

## Tangentbordsgenvägar

### Navigation

| Genväg | Funktion |
|--------|----------|
| `Cmd+←→↑↓` | Flytta fokus mellan paneler |
| `Tab` | Nästa ansikte/fält |
| `Shift+Tab` | Föregående ansikte/fält |

I **Filkö** hamnar `Tab` på en rad i listan; `↑`/`↓` flyttar mellan raderna och
`Enter`/`Blanksteg` laddar den fokuserade filen (samma som dubbelklick).

### Bildvisning

| Genväg | Funktion |
|--------|----------|
| `+` / `-` | Zooma in/ut (håll för kontinuerlig) |
| `=` | Återställ till 1:1 |
| `0` | Auto-anpassa till fönster |
| `B` | Visa/dölj bounding boxes |
| `b` | Växla enstaka/alla boxar |
| `c` / `C` | Aktivera/avaktivera auto-centrering |
| `Shift+I` | Visa/dölj "Review Progress" (filnamn + köstatus) |

*Granskningsförloppet finns även i menyn: Visa → Visa granskningsförlopp.*

### Ansiktsgranskning

| Genväg | Funktion |
|--------|----------|
| `Enter` / `A` | Acceptera föreslagen matchning |
| `Shift+Cmd+A` | Acceptera alla förslag i bilden |
| `i` | Ignorera ansikte |
| `r` | Byt namn / ange namn (rensar fältet) |
| `1-9` | Välj matchningsalternativ |
| `↑` / `↓` | Föregående/nästa ansikte |
| `Tab` | Komplettera autocomplete-förslag |
| `x` | Hoppa till nästa fil |
| `Alt+Enter` | Lägg till filnamnstillägg (fritext, ej personnamn) för aktuell bild |
| `Cmd+⌫` | Flytta aktuell fil till papperskorgen och gå vidare (`Cmd+⌫` följer Finder; även Arkiv → "Flytta till papperskorgen") |
| `Cmd+Shift+⌫` | Ångra senaste radering (återställ filen till kön; Redigera → "Ångra radering") |
| `Esc` | Avbryt ändringar |

### Layout

| Genväg | Funktion |
|--------|----------|
| `Cmd+1` | Granskningsläge |
| `Cmd+2` | Jämförelseläge |
| `Cmd+3` | Helbild |
| `Cmd+4` | Statistikläge |
| `Cmd+5` | Köläge |
| `Cmd+Shift+]` | Lägg till kolumn |
| `Cmd+Shift+[` | Ta bort kolumn |

### Gallring (Gallra spelare)

Gallra spelare har två vyer: **enkelbild** (loupe, standard) och **översikt**
(rutnät/contact sheet). Växla med **Rutnät**-knappen i filterraden (markerad när
översikten är aktiv; valet sparas mellan omstarter).

Enkelbildsvyn använder samma canvas-bildvisare som Granska ansikten: **rulla med
mushjulet** för att zooma in/ut mot pekaren och **dra** för att panorera när du
zoomat in. Även bildvisarens zoomtangenter fungerar här: `+`/`-` zoomar in/ut,
`=` återställer till 1:1 och `0` autoanpassar till fönstret. Varje ny bild
börjar autoanpassad (fit-to-window), så att stega mellan filer nollställer
zoomen automatiskt. NEF/RAW visas via samma konvertering som tidigare.

| Genväg | Funktion |
|--------|----------|
| `↑` / `↓` (`k` / `j`) | **Enkelbild:** föregående/nästa. **Rutnät:** upp/ned en rad |
| `←` / `→` | **Rutnät:** en miniatyr åt vänster/höger (enkelbild: föregående/nästa) |
| `Alt`+pil | Bläddra sidvis (10 bilder, resp. 3 rader i rutnätet) |
| `+` / `-` | **Enkelbild:** zooma in/ut |
| `=` | **Enkelbild:** återställ till 1:1 |
| `0` | **Enkelbild:** anpassa till fönster |
| `x` / `Delete` / `Cmd+⌫` | Flytta bilden till papperskorgen och gå vidare (`Cmd+⌫` följer Finder) |
| Dubbelklick / `Enter` | **Rutnät:** öppna miniatyren i enkelbild. **Enkelbild:** byt namn manuellt |
| `Esc` | **Enkelbild:** tillbaka till översikten (om inget redigeras). Annars: kasta förhandsgranskningens avbockade namn |
| `Cmd+Enter` | Tillämpa avbockade namn från förhandsgranskningen (byter namn på filen) |
| `Cmd+Z` | Ångra (återställ senast gallrade bild) |
| `L` | Öppna aktuell bilds original-NEF i Lightroom (även högerklick-menyn) |

I **rutnätet** är klick på ett spelarnamn i statistik-kolumnen lägesberoende:
**enkelklick markerar** (highlightar) spelarens miniatyrer utan att filtrera bort
övriga, **dubbelklick filtrerar** rutnätet till bara spelarens bilder. I
**enkelbild** filtrerar enkelklick som vanligt.

### Allmänt

| Genväg | Funktion |
|--------|----------|
| `?` | Visa hjälp |
| `Cmd+O` | Öppna fil |
| `Cmd+Shift+I` | Importera |
| `Cmd+Shift+B` | Byt namn (NEF) |
| `Cmd+Shift+K` | Räkna spelare |
| `Cmd+Shift+G` | Gallra spelare |
| `Cmd+Shift+L` | Öppna i Lightroom (original-NEF för aktuell bild i Gallra spelare) |
| `Cmd+,` | Inställningar |
| `Cmd+S` | Spara ändringar |

---

## Kommandorad (CLI)

Appen kan öppnas från terminalen med `ansikten`-kommandot, som väljer rätt
arbetsflöde via ett subkommando. Är appen redan igång skickas argumenten till
det körande fönstret (rätt modul öppnas/fokuseras automatiskt).

```sh
ansikten faces *.NEF          # köa NEF för ansiktsgranskning och börja bearbeta
ansikten *.NEF                # samma sak — faces är standard när inget verb anges
ansikten culling MAPP         # öppna MAPP i Gallra spelare
ansikten cull MAPP            # alias för culling
ansikten import               # öppna Importera (minneskortet autodetekteras)
ansikten import MAPP          # ...och för-ifyll MAPP som destination
```

**Mål (verb):**

| Verb | Arbetsmängd | Standard |
|------|-------------|----------|
| `faces` (standard) | Ansiktskön (filer) | Lägg till + börja bearbeta |
| `culling` / `cull` | Gallra-mappar (roots) | Lägg till mappen |
| `import` | Destinationsmapp (valfri) | Öppna Importera; källkortet autodetekteras |

`import` skiljer sig från de övriga: sökvägen är en *destination* (dit filerna
kopieras), inte en källa — källan är det monterade minneskortet, som upptäcks
automatiskt. Destinationen behöver inte finnas (den skapas vid överföring), och
`--clear`/`--recursive` saknar betydelse för `import`. Utan destination används
den sparade standarddestinationen (samma fält som i Importera-modulen).

**`--clear` / `-c`** nollställer målets arbetsmängd *före* tillägg. Ensam (utan
sökväg) tömmer den bara:

```sh
ansikten faces --clear *.NEF      # töm ansiktskön, köa de nya filerna, starta
ansikten culling --clear MAPP     # ersätt gallrings-mapparna med MAPP
ansikten culling --clear          # töm gallrings-arbetsytan
```

Utan `--clear` är standard att **lägga till** i befintlig arbetsmängd.

**`--recursive` / `-r`** (endast culling): scanna även undermappar. Standard är
**bara den angivna mappen** (matchar shell-globens intuition — `ansikten culling
~/Bilder/match/` tar mappens filer, inte hela trädet under den):

```sh
ansikten culling MAPP             # bara MAPP
ansikten culling -r MAPP          # MAPP + alla undermappar
```

**Installation:** kommandot är skriptet [`bin/ansikten`](../../bin/ansikten) i
repot. Länka in det i din PATH:

```sh
ln -s "$PWD/bin/ansikten" ~/bin/ansikten   # kör från repo-roten
```

Skriptet kräver att appen är installerad i `/Applications/Ansikten.app` (macOS).

---

## Arbetsflöde

> **Startsida:** När appen startar utan filer i kön visas en startsida i
> arbetsytan. Överst ligger arbetsflödesstegen i ordning (**Importera · Byt
> namn · Granska ansikten · Räkna spelare · Gallra spelare**); under en
> **Verktyg**-avdelare når du resten av vyerna direkt (Databashantering, Förfina
> ansikten, Filkö, Statistik, Loggar, Inställningar, Temaredigerare). Varje knapp
> öppnar respektive vy (fyller arbetsytan; Granska ansikten öppnar review-
> layouten). **Importera** är aktiv bara när ett minneskort sitter i (uppdateras
> automatiskt) — övriga är alltid valbara. Startsidan försvinner så fort du
> öppnar en vy eller laddar en bild, och **kommer tillbaka om du stänger alla
> öppna moduler** så arbetsytan aldrig blir tom utan väg vidare.
>
> **Fortsätt där du var:** har du nyss importerat eller bytt namn i ett event
> visar startsidan högst upp en rad "Aktuell mapp: {mapp}" med en
> **Fortsätt**-knapp till nästa steg (efter import → *Byt namn*, efter namnbyte →
> *Granska ansikten*) — mappen är då redan förvald. Ingenting laddas automatiskt;
> raden är bara en genväg.

### 0. Importera från minneskort (valfritt)

1. Öppna **Importera** (`Cmd+Shift+I`). Modulen listar isatta minneskort med antal NEF.
2. Välj kort, målmapp (kom ihåg senaste), samt Flytta/Kopiera och om kortet ska matas ut.
3. Klicka **Importera** — en förloppsindikator visas; kortet matas ut efter felfri överföring.
4. När importen är klar visas knappen **"Döp om filer…"** i resultatet — den öppnar **Byt namn** med den importerade mappen redan ifylld (nästa steg).

### 0b. Byt namn på NEF (valfritt)

1. Öppna **Byt namn** (`Cmd+Shift+B`), välj mappen (ev. glob `DSC*`). Målmappen förväljs från den senast använda eventmappen (importsteget) och faller annars tillbaka på senaste importdestination.
2. **Förhandsgranska** visar `DSC… → YYMMDD_HHMMSS.NEF` (dubbletter får `-NN`; filer utan CreateDate hoppas över).
3. **Byt namn** utför; befintliga målnamn skrivs aldrig över.
4. När namnbytet är klart visas knappen **"Granska ansikten…"** i resultatet — den öppnar granskningsvyn (Filkö + Granska ansikten + Bildvisare) med den namnbytta mappen redan laddad i kön (nästa steg).

### 1. Lägg till filer

1. Klicka `+` i Filkö eller `Cmd+O`
2. Välj en eller flera NEF-filer
3. Filer läggs till i kön

Är kön tom och du nyss importerat eller bytt namn i ett event visar tomläget
en genväg **"Ladda {mapp}?"** som fyller kön med den senast använda
eventmappen med ett klick.

### 2. Granska ansikten

1. Klicka på en fil i kön för att ladda den
2. Ansikten visas i Granska ansikten-panelen
3. För varje ansikte:
   - **Acceptera** (`A`/`Enter`) om matchningen är korrekt
   - **Ignorera** (`I`) om ansiktet ska ignoreras
   - **Namnge** (`R` eller skriv i fältet) för nytt namn
   - **Välj alternativ** (`1-9`) för annan matchning

Längst ner i Granska ansikten-panelen visas en **kööversikt** som en
färgad stapel över hela kön: grönt = granskade den här sessionen,
orange = förbearbetade (i cachen, snabba att öppna) men ännu inte
granskade, grått = återstår. Håll muspekaren över stapeln för exakta
antal.

### 3. Spara och fortsätt

1. När alla ansikten är granskade:
   - Auto-advance går till nästa fil (om aktiverat)
   - Eller klicka **Skip** för att hoppa vidare
2. Ändringar sparas automatiskt

### 4. Byt namn (valfritt)

1. När filer är granskade, klicka Byt namn-knappen i Filkö
2. Bekräfta namnbytet
3. Filer får nya namn enligt mönstret `YYMMDD_HHMMSS_Namn1,_Namn2.NEF`

### 5. Räkna och gallra spelare (på utvecklade jpg)

1. Öppna **Räkna spelare** (`Cmd+Shift+K`). Ange en mapp och/eller ett wildcard
   i balken högst upp, välj filtyp (vanligen `jpg / jpeg`) och ev. datum-span,
   och klicka **Räkna**. Tabellen visar antal bilder per spelare, andel, avvikelse
   från baslinjen i procent (Δ%, grön/gul/röd — peka på kolumnen för en
   förklaring) och antal (ΔN), en fördelningsstapel
   relativt baslinjen (baslinjen = halva stapeln) samt en **tidslinje** som visar
   när spelarens bilder togs under passet. Bocka i **Per match** för samma
   uppställning per automatiskt detekterad match — varje match visar även en
   info-rad (spelarantal och baslinje) och de exkluderade grupperna
   (tränare/gruppbilder/publik/under tröskeln). Tabellen speglar `rakna_spelare`-
   CLI:t. Statistiken uppdateras automatiskt när filer läggs till, tas bort eller
   byter namn i mappen.
   > **Alternativ (rad under balken):** **Matchgap** (minsta lucka i minuter som
   > delar upp bilderna i matcher, standard 30), **Baslinje** (median/medel) och
   > **Min bilder** (minsta antal för att räknas som spelare, standard 3) styr
   > räkningen live. Under **Uteslutna** redigerar du listorna för tränare och
   > publik — ändringarna gäller bara den aktuella räkningen tills du klickar
   > **Spara som standard** (då skrivs de till config och gäller även framtida
   > räkningar och CLI:t). Under **Alltid uteslutna (sparas)** redigerar du de
   > markörer som alltid räknas som gruppbilder/publik oavsett tröskel — som
   > standard `Laget`/`FBK`/`Klacken`, men du kan lägga till egna (t.ex. en
   > `Forward`-gruppetikett) eller ta bort en inbyggd; dessa gäller efter **Spara
   > som standard**. Om en `RAKNA_*`-miljövariabel är satt varnar editorn för att
   > sparningen kanske inte får effekt. Motsvarar CLI:ns
   > `--gap-minutes`/`--baseline`/`--min-images` och `--tranare`/`--publik` samt
   > config-nycklarna `always_grupp`/`always_publik`.

   > **Högerklicka ett namn** i spelartabellen eller i de exkluderade
   > sektionerna för en meny som flyttar namnet mellan kategorierna **för den
   > aktuella sessionen** — t.ex. gör en publik-/gruppmarkerad person till
   > spelare (räknas då även om den har färre än **Min bilder**), eller flytta
   > en spelare som bara spelade kort tid till publik. Sessionflyttarna delas
   > med Gallra spelare-vyns räknekolumn (samma meny finns där), överlever
   > omladdning men nollas när appen startas om, och sparas aldrig:
   > **Återställ** rensar dem och **Spara som standard** tar inte med dem.
   > Tillfälliga spelare visas som chips under **Uteslutna** (ta bort chipet =
   > ångra). Menyvalet **Gör publik permanent** skriver däremot namnet direkt
   > till publik-listan i config (utan att spara övriga osparade ändringar).
2. Klicka på en spelare i tabellen för att öppna **Gallra spelare**
   (`Cmd+Shift+G`) filtrerad på den spelaren. Filtret kan finjusteras med
   spelar-menyn eller ett eget glob (t.ex. `*ArvidW*`) i balken. Välj filtyp
   (`jpg`/`nef`/`raw`) i balken — `nef`/`raw` används för allmän gallring på
   råfiler innan namn satts (förhandsvisas via NEF→JPG-konvertering;
   spelar-menyn är då tom och du filtrerar på mapp/datum/glob).
   > **Delat urval:** Räkna spelare och Gallra spelare speglar samma
   > fil-urval (mappar, globbar, datumspann, filtyp). Öppnar du den ena med
   > ett urval aktivt i den andra ärvs det automatiskt — du slipper ange om
   > samma mapp. (Spelar-/namnfiltret i Gallra ärvs inte; Räkna räknar alla.)
   > **Delad baslinje:** även räkne-inställningen **Baslinje** (median/medel)
   > delas mellan de två — byter du median/medel i den ena följer den andra
   > med direkt (även om båda är öppna samtidigt), och valet sparas mellan
   > omstarter (till skillnad från det sessions-bundna urvalet). Detsamma
   > gäller **Min bilder** och **Matchgap**.
3. Bläddra i fillistan i mitten — `→`/`↓` nästa, `←`/`↑` föregående (`Alt`+pil
   hoppar 10 i taget); bilden visas maximerad till höger. **Högerklicka** en fil
   för en meny med navigering, byt namn, gallra och ångra — varje rad visar sitt
   kortkommando (så du lär dig genvägarna). Alla genvägar finns även i
   genvägshjälpen (`?`).
   Längst till vänster visas en **levande spelarräkning** för det aktuella
   urvalet som uppdateras direkt när du gallrar — så du ser hur varje spelares
   antal förändras. I räknekolumnens huvud finns en liten **Baslinje**-väljare
   (Median/Medel) som styr referensen för över-/underrepresentation, och ett
   litet **Min bilder**-fält (minsta antal bilder för att räknas som spelare —
   färre hamnar under "Under tröskeln"). Fältet skrivs in medan du skriver men
   räknar om först vid blur/Enter (så "12" inte kör tre omräkningar). Båda
   kontrollerna delar inställning med Räkna spelare-fliken (ändrar du här ändras
   även den, och valet kvarstår mellan omstarter). **Matchgap** styrs kvar från
   Räkna spelare-fliken. En liten snurra i kolumnhuvudet visas medan räkningen
   läses om (t.ex. efter ett baslinjebyte). Även de **exkluderade grupperna**
   (tränare/gruppbilder/publik/under tröskeln) är klickbara där för att
   filtrera/markera personen,
   och **högerklick på ett namn** (spelare eller exkluderad) ger samma
   session-/permanent-meny som i Räkna spelare — flytta t.ex. en
   publikmarkerad person till spelare för sessionen, direkt medan du gallrar. Tryck `x` (eller `Delete`) för att flytta bilden till
   papperskorgen och gå vidare (`Cmd+⌫` fungerar också, à la Finder). `Cmd+Z`
   ångrar.
   - **Byt namn på en fil:** tryck `Enter` på markerad fil (eller dubbelklicka)
     för att redigera filnamnet direkt i listan (filändelsen behålls). `Enter`
     bekräftar, `Esc` avbryter. Användbart när en utvecklad jpg har beskurits så
     att en namngiven spelare inte längre är med i bild. `.xmp`-sidecars följer
     med, och befintliga filnamn skrivs aldrig över.
   - **Snabb bortbockning av namn:** överst i förhandsgranskningen visas filens
     namn som ikryssade chips. Bocka av ett namn så uppdateras filnamnet **live
     i fillistan till vänster** — den aktuella raden blir orange så länge
     ändringen inte är sparad. `Cmd+Enter` byter namn på filen på riktigt; `Esc`
     kastar de avbockade namnen för aktuell fil (raden blir vit igen) utan
     dialog. Snabbare än
     manuell redigering när bara en spelare ska bort ur en beskuren bild. Om du
     navigerar vidare med en osparad ändring frågar en dialog: `Cmd+Enter`
     sparar, `Enter` kastar (förval), `Esc` avbryter — så ett påbörjat namnbyte
     inte tappas av misstag.
   - **Auto-advance efter namnbyte:** efter ett namnbyte (både `Enter`-redigering
     och `Cmd+Enter`-bortbockning) hoppar markeringen vidare till nästa fil, så
     du kan jobba dig igenom serien. Stängs av under Inställningar → Files →
     Gallra spelare ("Auto-advance after rename"); på som standard.
4. Papperskorgen (knappen **Papperskorg**) listar gallrade bilder och återställer
   dem till ursprungsplatsen, eller tömmer permanent. En filtypsmeny (Alla / jpg /
   nef-raw) låter dig granska och återställa JPEG och råfiler separat; **Töm**
   tömmer då bara det filtrerade urvalet (allt när menyn står på Alla). **Töm**
   kräver en bekräftelse (antal filer anges) eftersom tömningen är permanent och
   inte kan ångras. Gallrade filer rensas
   automatiskt efter en konfigurerbar tid (standard 30 dagar; `0` = behåll för
   alltid), ställbart i **Preferences → Files → Trash (Gallra)**. Rensningen körs
   när backend startar och när papperskorgen öppnas.

---

## Inställningar

Öppna med `Cmd+,` eller via menyn.

### Kategorier

- **General** - Backend, tema, standardlayout
- **Layout** - Layoutmallar och rutnät
- **Bildvisare** - Zoom, panorering
- **Review** - Auto-save, bekräftelser, antal alternativ
- **Files** - Kö, namnbyte
- **Preprocessing** - Bakgrundsbearbetning, cache, rolling window
- **Dashboard** - Statistiksektioner
- **Advanced** - Loggning, debug-kategorier

### Rolling Window (Preprocessing)

Förhindrar att cachen fylls vid stora köer (1000+ bilder). Preprocessningen pausar automatiskt när tillräckligt många filer är redo, och återupptas när du granskat några.

| Inställning | Standard | Beskrivning |
|-------------|----------|-------------|
| **Max Ready Items** | 15 | Max antal preprocessade filer att hålla redo |
| **Pause Buffer** | 10 | Pausa när så här många är redo (bör vara märkbart mindre än Max Ready Items) |
| **Resume After** | 5 | Återuppta efter så många granskade |
| **Status Indicator** | På | Visa status i Filkö-footern |
| **Toast on Pause** | På | Visa meddelande vid paus |
| **Toast on Resume** | Av | Visa meddelande vid återstart |

---

## Tema

Välj tema i Allmänt-inställningar eller via Temaredigeraren (`Cmd+Shift+T`):

- **Light** (Terminal Beige) - Ljust retro-tema
- **Dark** (CRT Phosphor) - Mörkt CRT-tema
- **System** - Följer systemets inställning

Temaredigeraren ger full kontroll över färger och presets. Destruktiva åtgärder
kräver bekräftelse: **Ta bort förval** (namnger förvalet som tas bort) och
**Återställ tema** (nollställer dina osparade färg-/storleksjusteringar; sparade
förval påverkas inte). Motsvarande gäller i Inställningar för **Återställ
inställningar** och **Rensa cache**.

---

## Tips

1. **Snabb granskning**: Använd `1-9` för att snabbt välja matchningsalternativ
2. **Batch-läge**: Aktivera auto-advance för snabbare genomgång
3. **Fix-läge**: Aktivera för att omgranska redan bearbetade filer
4. **Stora köer**: Rolling Window hanterar 1000+ bilder utan att fylla minnet
5. **Ångra**: Använd Database-modulen för att ångra filändringar
6. **Autocomplete**: Använd `↑`/`↓` för att bläddra i förslag och `Tab` för att komplettera valt namn
7. **Database-filter**: I Database-modulen finns ett filterfält ("Filter names...") med fuzzy-matchning
8. **Enter kör åtgärden**: I Databashantering och Förfina ansikten är varje åtgärd ett formulär — tryck `Enter` i valfritt fält för att köra den (t.ex. byt namn, slå samman, radera). Namnfälten har autocomplete över kända personer: `↑`/`↓` bläddrar och `Enter` väljer markerat förslag (annars kör `Enter` åtgärden). Destruktiva åtgärder (radera, rensa kodningar) ber om bekräftelse först.
