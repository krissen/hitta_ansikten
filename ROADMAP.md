# ROADMAP - Ansikten

Framåtblickande lista över planerade förbättringar, kända brister och teknisk
skuld. Den är *inte* en logg över vad som gjorts — avklarade poster tas bort
efter merge (om de inte hänger ihop med pågående arbete); `CHANGELOG.md` är den
varaktiga posten över vad som skeppats.

**Denna fil vs [docs/dev/performance-plan.md](docs/dev/performance-plan.md):**
den här filen är den löpande backlogen/known-issues/teknisk skuld över alla
horisonter; `performance-plan.md` är en smalare, release-scopad plan (sprintar,
deliverables, DoD) för en prestandarelease.

**Senast uppdaterad:** 2026-07-08

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
- [x] **PR 4a — Konfigurerbar `det_size`, standard 1280×1280** — billigaste recall-hävstången för små ansikten. Läses från `backend.insightface.det_size` (list/int), strategi-token i detektionscachens nyckel, effektiv `det_size` loggad vid init. Diagnostik: `backend/benchmarks/detsize_compare.py`. Uppmätt på 7 lokala helbilder (2 NEF + 5 lagfoton): recall i stort sett neutralt (±1 ansikte, ingen ground truth), vägg-tid ~1,2–1,75×. Sanning: en större vinst kräver benchmark-datasetet (B-spåret) för ground-truth-recall.
- [ ] **PR 4b — Tiling för detektion (small-face recall, forts.)** — kör detektion på överlappande brickor för att yta ännu mindre ansikten. Strategi-tokenens tiling-flagga (`+t0`→`+t1`) är redan förberedd i detektionscachens nyckel; PR 4b driver den från config.
- [ ] **Concurrency-limits för dyra endpoints** — ingen per-endpoint-semafor för `detect`/`thumbnail`/`preprocess` ännu. Kvarvarande post från [performance-plan.md](docs/dev/performance-plan.md) (Sprint 1).
- [ ] **Auto-pausa bakgrundsrefresh för dolda/inaktiva moduler** — refresh är användarstyrd men pausas inte automatiskt när modulen inte ligger i aktiv tabset; minska även onödig global listener-rebinding. Kvarvarande post från [performance-plan.md](docs/dev/performance-plan.md) (Sprint 3).
- [ ] Utveckla smidigare stöd för terminal-interaktion med backend (synkat med frontend).
- [ ] **FileQueueModule: `n`/`p`-genvägarna är fortfarande enbart visibility-gate:ade** — efter aktiv-tabset-svepet (I1) gatar Review och Culling på aktiv tabset via `hooks/useActiveTabset.js`, men FileQueues globala `n`/`p` (nästa/föregående fil) körs så länge panelen är synlig. Ingen aktiv konflikt idag (varken Review eller Culling binder `n`/`p`, och FileQueue saknar delete-genväg), men FileQueue är en *companion-drivare*: den ska förbli aktiv medan Review/bildvisaren är aktiv, så en naiv migrering till "egen tabset aktiv" skulle bryta flödet. Kräver companion-modellering (companions = review/image-viewer) — egen PR. `PlayerCountModule` har ingen global tangentlyssnare (inget att migrera).
- [ ] **Arbetsflödes-layoutpresets** — spara flerfönsterkonfigurationer per uppgift (t.ex. NEF-culling = fillista vänster + maximal preview höger). De flesta vyer är single-instance: öppna inte flera, skifta fokus till befintlig.

### Benchmark-spår (ansiktsigenkänning)

- [x] **B1 — Källbilds-resolver + genomförbarhetsrapport** (grind för hela spåret). `backend/benchmarks/` bygger SHA1→sökväg-index och joinar mot databasens hashar; genomförbarhetsrapport klar. **Utfall: GO.** Lokalt löses bara ~0,5 % av källbilderna (originalen arkiverades bort efter behandling), men restic-backupen (Hetzner + kailash-T7, läst via `kosha`) innehåller ~80 % exakt (2 188 av 2 728 olösta bilder) → projicerad total ~80 % bilder/ansikten och **87 av 104 identiteter blir gallery+probe-bärkraftiga**. Hämtvägen är end-to-end-verifierad (`restic dump` → lokal staging, SHA1 matchar databasen exakt). Uppskattad restore-volym ~91 GB.
- [ ] **B2 — Full backup-restore till staging** — bulk-restore av de ~2 188 återhämtningsbara händelsemapparna (~91 GB) från restic till `~/.local/share/faceid/benchmark_staging/`, kör om `resolve.py`, bekräfta hash-join. Kräver restic-restore på kailash (creds ligger där) streamat till kedar; olöst-listan i `benchmarks/_data/unresolved_hashes.json` är arbetslistan.
- [ ] **B3+ — Bygg gallery/probe-splits och kör benchmark** — efter restore: skapa utvärderingsdataset med hårda strata (Björneholt-tvillingparet, syskon-efternamnsgrupper, små bbox-areor).

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

### Backend

- [ ] **Versionsnumret är dubblerat på tre ställen.** Appversionen står hårdkodad i `frontend/package.json`, `backend/pyproject.toml` och som `version=`-strängen i `backend/api/server.py` (exponeras via `/health`). Vid release skriver CI över `frontend/package.json` från `v*`-taggen, men de två backend-förekomsterna måste bumpas för hand och kan glida isär (som de gjorde: backend låg kvar på 1.0.0 medan frontend var 1.3.0). Idealt läser `server.py` versionen från paketmetadata (`importlib.metadata.version("ansikten-backend")`) med en fallback — men det kräver verifiering att metadatan finns i det PyInstaller-paketerade bygget innan det görs. Tills vidare: bumpa alla tre tillsammans (se [release-guide.md](docs/dev/release-guide.md)).
- [ ] **Divergerade namn-/filnamnshjälpare mellan `core/naming.py` och `api/services/rename_service.py`.** Vid utlyftet av namnklustret till `core/naming.py` (audit-steg 2) avdupliceras endast `normalize_name` (byte-identisk). De övriga fem portade hjälparna i `rename_service` har medvetet avvikit från monolitens versioner och kan därför **inte** ersättas rakt av en import: `extract_prefix_suffix`/`is_unrenamed` har utökade regexar (fotografsuffix `[a-zA-Z]{0,3}` + generisk `_EXT_PATTERN` för alla stödda ändelser, inte bara `.NEF`); `resolve_fornamn_dubletter` och `build_new_filename` tar en `config`-parameter (`useFirstNameOnly`, `disambiguationStyle`, separatorer, EXIF/datum-prefix, manuellt suffix) via `build_new_filename_with_config`; `split_fornamn_efternamn` hanterar tom input (`parts[0] if parts else ""`). Två divergerande sanningskällor för samma filnamnskonvention är en regressionsrisk. Framtida konsolidering: gör `core/naming`-versionerna till supersets (config-medvetna, backåtkompatibla defaults) så CLI och API kan dela dem — kräver verifiering att CLI-beteendet (endast `.NEF`, förnamn-only) bevaras.
- [ ] **`undo_file` rensar known+ignored per hash men inte `hard_negatives`** — en ångrad fil kan lämna kvar hårda negativ som refererar dess encodings. Pre-existerande (oförändrad av #149); avgör om undo även ska purga matchande hardneg-poster. Noterat i granskningen av #149.
- [ ] **`core/db.py`s pickle-whitelist saknar numpy 2.x `_frombuffer`-vägen.** `ALLOWED_CLASSES` i den restriktiva unpicklaren listar `numpy(._core|.core).multiarray._reconstruct/scalar` men **inte** `numpy._core.numeric._frombuffer` (numpy 2.x) / `numpy.core.numeric._frombuffer` (numpy 1.26). Arrayer som picklats via `np.frombuffer`-vägen fäller därför `UnpicklingError: Forbidden class` vid laddning — reproducerbart i en färsk venv (test_faceid_db + test_management_service: 47 fall) oberoende av trösklfixen. Lägg till båda modulväg-varianterna av `_frombuffer` i whitelisten (spårar mönstret för `_reconstruct`/`scalar`). Hittad under PR fix/threshold-single-source.
- [ ] **Latenta buggar i faceid_db, pinnade av karakteriseringstesterna (#125):** (1) `normalize_encoding_entry` muterar input-dicten in place och returnerar samma objekt; (2) asymmetrisk `encoding_hash` — dict-grenen sätter bara nyckeln när `encoding is not None`, så manuella ansikten saknar den helt (KeyError-risk downstream) medan bare-array-grenen alltid sätter den; (3) `load_database` propagerar rå `UnpicklingError` vid korrupt/otillåten pickle — en trasig fil fäller hela laddningen. Åtgärdas lämpligen i fas C/D av auditen (core/db.py-flytten eller FaceDBStore).

### Frontend

- [ ] **FileQueueModule accepterar bara 3 av 9 RAW-format** — `SUPPORTED_EXTENSIONS` listar nef/cr2/arw men backend hanterar även cr3/dng/raf/orf/rw2/raw (`core/files.py RAW_EXTENSIONS`); filer i de formaten avvisas i kön trots att pipelinen klarar dem. Avgör om det smala setet är medvetet; synka annars mot backend. Noterat i granskningen av #137.
- [ ] **`_classifyError(null, response)` gör en oavsiktlig dubbelklassificering** — på non-ok-svar i api-client kastar `_classifyError` internt en TypeError (err är null, `err.name` läses) som yttre catch sväljer och omklassificerar; slutresultatet blir rätt men via en olycksväg. Gör `_classifyError` null-säker (`err?.name`). Pre-existerande; noterat i granskningen av #138.
- [ ] **Tailwind-utilities `text-success/-warning/-error/-info` krockar med legacy-klasserna med samma namn.** `theme.css` definierar `.text-success` m.fl. (färg via `--color-*-text`); Tailwind-lagret genererar utilities med identiska namn (färg via `--color-*`). Legacy vinner alltid (olagrad CSS > Tailwinds `@layer utilities`), så beteendet är oförändrat idag — men namnkrocken är en fälla. Städas när `.status`-/`.text-*`-lagret migreras till utilities (fas B): ta bort legacy-reglerna i samma PR, så pekar namnet entydigt på Tailwind-utilityn. Se [theming.md](docs/dev/theming.md) (Tailwind-lagret).
- [ ] **Roving tabindex — kvar: Preferences/ThemeEditor-sidonav.** Det gemensamma mönstret beslutades och implementerades i B7 för den värsta listan, `FileQueueItem` (100+ rader): en enda roving-target-rad är tabbar (`tabIndex 0`), övriga `-1`, pilar flyttar markören; dokumenterat i [accessibility.md](docs/dev/accessibility.md) §2a. Kvar att migrera till samma mönster: Preferences- och ThemeEditor-sidonavens `role="button"`-rader (mindre listor, lägre risk). Ursprung: Nagelfar-granskningen av #174. Följdfråga från #178: överväg `role="option"`+`role="listbox"` i stället för `role="button"` på FileQueueItem-raderna — button-rollen tillåter formellt inga interaktiva ättlingar (checkbox/IconButtons; axe flaggar), medan option-modellen är valid; avgörs ihop med sidonav-migreringen.
- [ ] **`InputBar` har kvar hårdkodad svenska.** Den delade `InputBar` (används av Räkna spelare m.fl.) har oöversatta strängar ("+ Mapp", wildcard-placeholder, "Från"/"Till", filtypspresets, titlar). B7 migrerade bara dess knappar till `Button`-primitiven (för alias-städningen), inte i18n:en — utanför B7:s modul-scope. Ge den ett eget namespace (t.ex. `inputBar`) nästa gång en modul som bäddar in den rörs. Noterat i B7.
- [ ] **ImageViewer: tema-cache-invalidering är bredare än nödvändigt.** `MutationObserver`:n på `<html>` bevakar `style`-attributet för att fånga ThemeEditors live-preview (inline CSS-vars utan event), men det betyder att *varje* inline-var-skrivning på `<html>` (t.ex. `--toast-opacity`) invaliderar färgcachen och triggar en omritning — harmlös men onödig koppling. Föredra på sikt ett scopat `theme-vars-changed`-event som ThemeEditor (och andra var-skrivare) skickar explicit, så observern kan tas bort. Noterat i granskningen av #142 (Nagelfar issue-003).
- [ ] **FormField-primitiven (label+hint+error med `aria-describedby`) ännu inte byggd.** Planerad för fas B1 men medvetet uppskjuten där: Database/RefineFaces har placeholder-drivna inline-rader och täta grid-layouter (RefineFaces config-grid) där en staplad FormField hade krävt omdesign (mot "ingen omdesign"-målet). Bygg den när en modul med genuint staplade fält migreras (t.ex. Preferences/Import) och associera då labels + hints via `aria-describedby`; migrera RefineFaces config-rader om det kan ske utan att bryta grid-layouten.

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
