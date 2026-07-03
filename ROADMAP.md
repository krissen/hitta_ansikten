# ROADMAP - Ansikten

Framåtblickande lista över planerade förbättringar, kända brister och teknisk
skuld. Den är *inte* en logg över vad som gjorts — avklarade poster tas bort
efter merge (om de inte hänger ihop med pågående arbete); `CHANGELOG.md` är den
varaktiga posten över vad som skeppats.

**Denna fil vs [docs/dev/performance-plan.md](docs/dev/performance-plan.md):**
den här filen är den löpande backlogen/known-issues/teknisk skuld över alla
horisonter; `performance-plan.md` är en smalare, release-scopad plan (sprintar,
deliverables, DoD) för en prestandarelease.

**Senast uppdaterad:** 2026-07-03

---

## Roadmap

### Nu

(Inget pågående just nu.)

### Kort sikt

- [ ] **Import-subkommando** — `ansikten import [MÅL]` öppnar Import-modulen. PATH-semantiken skiljer sig (import tar en *destination*, källan är autodetekterat kort), så det kräver egen design.

### Mellan sikt

- [ ] **Repo-flytt** — be användaren flytta repot och ange den nya adressen; ändra remote i `.git/`: `git remote set-url origin https://github.com/krissen/ansikten.git`. (Docs-referenser är redan uppdaterade.)
- [ ] **Lokal mapp-flytt** (manuellt: `hitta_ansikten/` → `ansikten/`).
- [ ] **Backend distance-optimering** — optimera distansberäkningar för bättre prestanda. Del av den bredare prestanda-planen: [docs/dev/performance-plan.md](docs/dev/performance-plan.md).
- [ ] Utveckla smidigare stöd för terminal-interaktion med backend (synkat med frontend).
- [ ] **Modulgenvägar bör villkoras på aktiv tabset, inte bara synlighet** — globala tangentlyssnare (t.ex. ReviewModule som bekräftar ansikte på `Enter`) gatar idag på `node.isVisible()`. I en delad layout med flera synliga paneler fångar då en *synlig men inaktiv* panel tangenter som hör till den aktiva. CullingModule försvarar sig redan (Enter-genväg på document i capture-fas + aktiv-tabset-gate + `stopImmediatePropagation`), men det generella mönstret kvarstår för övriga moduler. ReviewModule m.fl. bör gatas på aktiv tabset. **Varning:** måste inte bryta Reviews normala flöde där man klickar i bildvisaren och sedan trycker tangent (då blir bildvisarens tabset aktiv) — kräver genomtänkt fokus-/aktiv-modell, egen PR.
- [ ] **Arbetsflödes-layoutpresets** — spara flerfönsterkonfigurationer per uppgift (t.ex. NEF-culling = fillista vänster + maximal preview höger). De flesta vyer är single-instance: öppna inte flera, skifta fokus till befintlig.
- [ ] **Docs-uppdatering (dev-docs)** — användardokumenten och ROADMAP är genomgångna (2026-07-02). Kvar: dev-docs (`docs/dev/architecture.md`, `docs/dev/onboarding.md` m.fl.) kan ha kvar engelska modulnamn/inaktuella referenser efter i18n-svepet och rebranden.

### Lång sikt

- [ ] **Plugin-system** - Utökningsbart system för tredjepartsmoduler
- [ ] **Tab maximization** - Möjlighet att maximera en tab tillfälligt
- [ ] **Floating windows** - Stöd för fristående fönster för moduler

---

## Kända brister

### UI/UX

- [ ] **CLI launch: landing döljs vid sökväg som expanderar till tomt** — renderaren härleder landningssidans suppression från råa arg-antalet (`hasFiles`), men huvudprocessen skickar bara handoff efter sökvägsexpansion (`expandFolderPaths`/`expandFilePaths` → `length>0 || clear`). En syntaktiskt giltig men icke-matchande sökväg (t.ex. `ansikten culling /typo` eller en glob utan träffar) döljer landningen utan att öppna något → användaren hamnar i default-layouten istället. Ren fix: låt huvudprocessen beräkna post-expansion-villkoret och exponera den boolean:en som launch intent istället för att renderaren gissar från råa argument (kräver async-hantering för faces). Pre-existerande edge (user-error), icke-blockerande; flaggad i PR #67-granskningen.

---

## Teknisk skuld

### Frontend

- [ ] "Öppna i Lightroom" (`open-raw-in-lightroom`) läser hela RAW-roten rekursivt i minnet per tangenttryck och sorterar för deterministisk första-träff. Räcker för dagens per-match-mappar; för en stor RAW-rot, byt till en strömmande DFS-walk med tidig utgång (behåll deterministisk traverseringsordning) eller cachea filindexet.
- [ ] **Tangentbordstest för CullingModules Enter/Esc-gate** — capture-fas-lyssnaren (gate på FlexLayout-node/aktiv-tabset + `menuRef`) saknar enhetstest för "Enter är no-op när kontextmenyn är öppen och läcker inte till andra moduler" och motsvarande för `Esc`. Låg impact (musdriven meny), men regressionsbenägen (jfr #81). Kräver tyngre DOM/FlexLayout-mockning eller att beslutslogiken extraheras till en ren predikat-funktion som kan testas. Noterat i granskningen av #106.
- [ ] **Gallra spelare — rutnätsminiatyrer cache-bustar inte vid in-place om-export** — översiktsvyn (rutnätet, #113) hämtar miniatyren via `useGridThumbnail(path, size)` utan fingerprint, så en om-export i Lightroom (samma sökväg) syns i rutnätet först när man öppnar bilden i enkelbild (loupe:n bustar via `stat-file-stable`) eller startar om. Medvetet val för att slippa hämta om hela rutnätet vid varje mappändring; `grid-thumbnail-cache.js` stödjer redan en `fingerprint`-param (läggs i både cache-nyckel och URL) om den ska trådas in per cell.
- [ ] **`gridThumbnailCache.clear()` är inte inkopplad** — metoden (med generation-guard mot in-flight-fetchar) finns men anropas inte från någon plats; ren defensiv kod. Koppla in vid t.ex. mapp-/scope-byte om rutnäts-blobar behöver frigöras aktivt, annars kan den förenklas.

---

## Anteckningar

### DEPRECATED: dlib backend

dlib-backend är borttaget. InsightFace är det enda stödda backend.

- Alla befintliga dlib-encodings raderas automatiskt vid serverstart
- Legacy-scriptet (hitta_ansikten.py) tvingar insightface om dlib konfigureras
- Encoding-shape är alltid (512,) för InsightFace

### Projektnamnbyte

Projektet heter **Ansikten**. "Hitta ansikten" och "Bildvisare" var tidigare namn som inte längre används.
CLI-filen heter fortfarande `hitta_ansikten.py` (legacy).

### Prioritering

- **P1** - Blockerar arbetsflöde
- **P2** - Förbättrar produktivitet
- **P3** - Nice-to-have

### Kontribuera

Se [docs/dev/contributing.md](docs/dev/contributing.md) för hur du bidrar.
