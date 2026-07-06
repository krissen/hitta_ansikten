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

(Inget just nu.)

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

### Dokumentation

- [ ] **Odokumenterade endpoints i api-reference.md** — `POST /api/v1/batch-confirm` (detection.py) och `POST /api/v1/statistics/file-stats` (statistics.py) saknas i docs/dev/api-reference.md. Noterat i granskningen av #123; tas i auditens docs-slutsvep.

---

## Teknisk skuld

### Backend

- [ ] **Versionsnumret är dubblerat på tre ställen.** Appversionen står hårdkodad i `frontend/package.json`, `backend/pyproject.toml` och som `version=`-strängen i `backend/api/server.py` (exponeras via `/health`). Vid release skriver CI över `frontend/package.json` från `v*`-taggen, men de två backend-förekomsterna måste bumpas för hand och kan glida isär (som de gjorde: backend låg kvar på 1.0.0 medan frontend var 1.3.0). Idealt läser `server.py` versionen från paketmetadata (`importlib.metadata.version("ansikten-backend")`) med en fallback — men det kräver verifiering att metadatan finns i det PyInstaller-paketerade bygget innan det görs. Tills vidare: bumpa alla tre tillsammans (se [release-guide.md](docs/dev/release-guide.md)).
- [ ] **Test-import väcker eager singleton + skriver till riktig logg** — att importera `detection_service` (som flera testfiler gör) kör modulnivå-singletonen (`detection_service.py:1167`): riktig InsightFace-laddning, riktig DB-läsning och appends till `~/.local/share/faceid/ansikten.log`. Ingen pkl-state läcker, men testerna ska inte röra riktiga datamappen. Närtidsfix: `backend/tests/conftest.py` som redirectar LOGGING_PATH till tmp; riktig fix: auditens fas D5 (lazy getters i st.f. import-time-singletons). Noterat i granskningen av #130 (Nagelfar issue-001). Relaterat: `StatisticsService.get_summary`-docstringen säger "cached for 2 seconds" men `cache_ttl = 30.0` — doc-bugg som rättas i refaktor-PR:en.
- [ ] **Divergerade namn-/filnamnshjälpare mellan `core/naming.py` och `api/services/rename_service.py`.** Vid utlyftet av namnklustret till `core/naming.py` (audit-steg 2) avdupliceras endast `normalize_name` (byte-identisk). De övriga fem portade hjälparna i `rename_service` har medvetet avvikit från monolitens versioner och kan därför **inte** ersättas rakt av en import: `extract_prefix_suffix`/`is_unrenamed` har utökade regexar (fotografsuffix `[a-zA-Z]{0,3}` + generisk `_EXT_PATTERN` för alla stödda ändelser, inte bara `.NEF`); `resolve_fornamn_dubletter` och `build_new_filename` tar en `config`-parameter (`useFirstNameOnly`, `disambiguationStyle`, separatorer, EXIF/datum-prefix, manuellt suffix) via `build_new_filename_with_config`; `split_fornamn_efternamn` hanterar tom input (`parts[0] if parts else ""`). Två divergerande sanningskällor för samma filnamnskonvention är en regressionsrisk. Framtida konsolidering: gör `core/naming`-versionerna till supersets (config-medvetna, backåtkompatibla defaults) så CLI och API kan dela dem — kräver verifiering att CLI-beteendet (endast `.NEF`, förnamn-only) bevaras.
- [ ] **Latenta buggar i faceid_db, pinnade av karakteriseringstesterna (#125):** (1) `normalize_encoding_entry` muterar input-dicten in place och returnerar samma objekt; (2) asymmetrisk `encoding_hash` — dict-grenen sätter bara nyckeln när `encoding is not None`, så manuella ansikten saknar den helt (KeyError-risk downstream) medan bare-array-grenen alltid sätter den; (3) `load_database` propagerar rå `UnpicklingError` vid korrupt/otillåten pickle — en trasig fil fäller hela laddningen. Åtgärdas lämpligen i fas C/D av auditen (core/db.py-flytten eller FaceDBStore).

### Frontend

- [ ] **FileQueueModule accepterar bara 3 av 9 RAW-format** — `SUPPORTED_EXTENSIONS` listar nef/cr2/arw men backend hanterar även cr3/dng/raf/orf/rw2/raw (`core/files.py RAW_EXTENSIONS`); filer i de formaten avvisas i kön trots att pipelinen klarar dem. Avgör om det smala setet är medvetet; synka annars mot backend. Noterat i granskningen av #137.
- [ ] **`_classifyError(null, response)` gör en oavsiktlig dubbelklassificering** — på non-ok-svar i api-client kastar `_classifyError` internt en TypeError (err är null, `err.name` läses) som yttre catch sväljer och omklassificerar; slutresultatet blir rätt men via en olycksväg. Gör `_classifyError` null-säker (`err?.name`). Pre-existerande; noterat i granskningen av #138.
- [ ] "Öppna i Lightroom" (`open-raw-in-lightroom`) läser hela RAW-roten rekursivt i minnet per tangenttryck och sorterar för deterministisk första-träff. Räcker för dagens per-match-mappar; för en stor RAW-rot, byt till en strömmande DFS-walk med tidig utgång (behåll deterministisk traverseringsordning) eller cachea filindexet.
- [ ] **Tangentbordstest för CullingModules Enter/Esc-gate** — capture-fas-lyssnaren (gate på FlexLayout-node/aktiv-tabset + `menuRef`) saknar enhetstest för "Enter är no-op när kontextmenyn är öppen och läcker inte till andra moduler" och motsvarande för `Esc`. Låg impact (musdriven meny), men regressionsbenägen (jfr #81). Kräver tyngre DOM/FlexLayout-mockning eller att beslutslogiken extraheras till en ren predikat-funktion som kan testas. Noterat i granskningen av #106.
- [ ] **Test för `gridThumbnailCache.clear()`-inkopplingen** — själva wiring:en (unmount-cleanup + `--clear`-teardown i CullingModule) saknar test; bara fingerprint-i-URL-vägen täcks (`cullingGridRender.test.jsx`). Låg impact — skulle kräva en full CullingModule-mount. Noterat i granskningen av #114.
- [ ] **Delete-till-papperskorg: möjlig dubbel-trash när både Granska ansikten och Gallra spelare är samtidigt synliga.** Både ReviewModule och CullingModule binder `Cmd+⌫` på egna visibility-gate:ade keydown-lyssnare utan korsavbrytning. I det smala fallet att Review hålls öppen (t.ex. smutsig granskning) *och* rivs ut i en egen synlig tabset när Gallra öppnas, kan ett enda `Cmd+⌫` radera två filer. Båda är mjukradering/ångerbara och normalflödet håller Review inaktiv/avmonterad (`isVisible()` false → säkert), så spårat snarare än blockerande. Noterat i granskningen av #118 (Nagelfar issue-005).

---

## Anteckningar

### DEPRECATED: dlib backend

dlib-backend är borttaget. InsightFace är det enda stödda backend.

- Befintliga dlib-encodings lämnas orörda vid serverstart — ingen boot-scan längre; rensa dem vid behov med `scripts/archive/rensa_dlib.py` eller remove-dlib-endpointen i refinement
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
