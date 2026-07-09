# ROADMAP - Ansikten

Framåtblickande lista över planerade förbättringar, kända brister och teknisk
skuld. Den är *inte* en logg över vad som gjorts — avklarade poster tas bort
efter merge (om de inte hänger ihop med pågående arbete); `CHANGELOG.md` är den
varaktiga posten över vad som skeppats.

**Denna fil vs [docs/dev/performance-plan.md](docs/dev/performance-plan.md):**
den här filen är den löpande backlogen/known-issues/teknisk skuld över alla
horisonter; `performance-plan.md` är en smalare, release-scopad plan (sprintar,
deliverables, DoD) för en prestandarelease.

**Senast uppdaterad:** 2026-07-09

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
- [x] **PR 4a — Konfigurerbar `det_size` (standard förblir 640×640)** — `det_size` läses från `backend.insightface.det_size` (list/int = kvadrat), strategi-token i detektionscachens nyckel, effektiv `det_size` loggad vid init. Diagnostik: `backend/benchmarks/detsize_compare.py`. **Standarden höjdes INTE** — mätning före beslut, nu avgjord av auditen (se nedan).
- [x] **Ompröva det_size-standarden (640 → 1280?) — AVGJORD: behåll 640.** Grindad på benchmark-spårets ground truth; auditens slutrapport ([docs/dev/face-recognition-audit-2026-07.md](docs/dev/face-recognition-audit-2026-07.md)) visar effektiv detektionsrecall ~99,8 % på box-bärande ansikten (99,5 % på minsta kvartilen); residualen är 5 ansikten. Att höja standarden ger ingen mätbar nettovinst till 1,2–1,75× kostnad. Att höja `det_size` förblir en stödd config-ratt.
- [ ] **PR 4b — Tiling för detektion (small-face recall) — EJ MOTIVERAD som standard.** Auditen (samma rapport) drar slutsatsen att tiling inte betalar sig vid ~99,8 % effektiv recall; behåll den bara som en valfri config-grindad experimentväg. Strategi-tokenens tiling-flagga (`+t0`→`+t1`) är redan förberedd i detektionscachens nyckel om den någonsin drivs från config.
- [ ] **Concurrency-limits för dyra endpoints** — ingen per-endpoint-semafor för `detect`/`thumbnail`/`preprocess` ännu. Kvarvarande post från [performance-plan.md](docs/dev/performance-plan.md) (Sprint 1).
- [ ] **Auto-pausa bakgrundsrefresh för dolda/inaktiva moduler** — refresh är användarstyrd men pausas inte automatiskt när modulen inte ligger i aktiv tabset; minska även onödig global listener-rebinding. Kvarvarande post från [performance-plan.md](docs/dev/performance-plan.md) (Sprint 3).
- [ ] Utveckla smidigare stöd för terminal-interaktion med backend (synkat med frontend).
- [ ] **FileQueueModule: `n`/`p`-genvägarna är fortfarande enbart visibility-gate:ade** — efter aktiv-tabset-svepet (I1) gatar Review och Culling på aktiv tabset via `hooks/useActiveTabset.js`, men FileQueues globala `n`/`p` (nästa/föregående fil) körs så länge panelen är synlig. Ingen aktiv konflikt idag (varken Review eller Culling binder `n`/`p`, och FileQueue saknar delete-genväg), men FileQueue är en *companion-drivare*: den ska förbli aktiv medan Review/bildvisaren är aktiv, så en naiv migrering till "egen tabset aktiv" skulle bryta flödet. Kräver companion-modellering (companions = review/image-viewer) — egen PR. `PlayerCountModule` har ingen global tangentlyssnare (inget att migrera).
- [ ] **Arbetsflödes-layoutpresets** — spara flerfönsterkonfigurationer per uppgift (t.ex. NEF-culling = fillista vänster + maximal preview höger). De flesta vyer är single-instance: öppna inte flera, skifta fokus till befintlig.

### Benchmark-spår (ansiktsigenkänning)

- [x] **B1 — Källbilds-resolver + genomförbarhetsrapport** (grind för hela spåret). `backend/benchmarks/` bygger SHA1→sökväg-index och joinar mot databasens hashar; genomförbarhetsrapport klar. **Utfall: GO.** Lokalt löses bara ~0,5 % av källbilderna (originalen arkiverades bort efter behandling), men restic-backupen (Hetzner + kailash-T7, läst via `kosha`) innehåller ~80 % exakt (2 188 av 2 728 olösta bilder) → projicerad total ~80 % bilder/ansikten och **87 av 104 identiteter blir gallery+probe-bärkraftiga**. Hämtvägen är end-to-end-verifierad (`restic dump` → lokal staging, SHA1 matchar databasen exakt). Uppskattad restore-volym ~91 GB.
- [x] **Benchmark-kärna — modellabstraktioner + buffalo_l-baslinje + 3-nivåcache** (auditplanens PR B2). `models/` (lätta `Detector`/`RecognitionModel`-protokoll + kanonisk `norm_crop`-inriktning + buffalo_l-adaptrar), `cache.py` (detektioner + embeddings under `_data/`), `dataset.py` (detektor + IoU≥0.5-match → `_data/dataset.jsonl`, hinkar matched/detector_missed/unresolved) och `baseline_check.py`. Regressionsbaslinje verifierad lokalt: omkodad buffalo_l-embedding reproducerar de lagrade `encodings.pkl`-vektorerna vid cosinus **1.0000** (median över 23 matchade ansikten; 8 detector_missed, 4 045 unresolved på de 14 lokalt upplösta bilderna). *Distinkt från B2-restore nedan — detta är modell-/mätkärnan, oberoende av backup-restore.*
- [x] **B2 (restore) — Full backup-restore till staging** — restore klar: **2 099 av 2 188** filer SHA1-verifierade mot databasen (`_data/restore_manifest.json`), 89 äkta mismatchar/otillgängliga uteslutna. Staging under `~/.local/share/faceid/benchmark_staging/`; hash-join bekräftad (full-N-körningen nedan bygger på den).
- [x] **B3 — Metrik- + rapportlager** (auditplanens PR B3). `metrics.py` (rena funktioner: closed-set rank-1/-5 i centroid- och max-sim-läge, open-set DIR@FAR, verifikations-ROC med impostor-delmängder all-comers/samma-efternamn/tvillingpar, tvillingförvirring, tröskelsvep 0,20–0,80 som validerar 0,4/0,35-defaults, detektionsrecall per stratum), `embeddings.py` (matched→cachade embeddings + blur = varians-av-Laplacian), `report.py` (stratifiering + markdown/CSV + matplotlib-plottar) och CLI:n `python -m benchmarks.run`. Enhetstester mot handräknbara syntetiska embeddings, inget insightface-beroende. Kört end-to-end på den **partiella** staging-delmängden medan restore pågick (rapport märkt partiell).
- [x] **B4 — LVFace-adapter** (auditplanens PR B4). Starkaste ONNX-klara, MIT-licensierade utmanaren mot buffalo_l: `models/download.py` (HF-hämtnings-CLI + committad `models_manifest.json` med sha256/licens/dim/preprocessing; vikter gitignorerade under `_data/models/`), `models/lvface.py` (`LVFaceRecognition` via onnxruntime på kanonisk 112×112-crop; preprocessing BGR→RGB / NCHW / `(x−127.5)/127.5` **verifierad mot referensen** github.com/bytedance/LVFace `inference_onnx.py`), och `models/verify_lvface_parity.py` (paritetsgrind: adapter vs ordagrann referens-pipeline på samma crop → cosinus > 0,999). `run.py` tar nu `--models buffalo_l,lvface_base`. Enhetstester bygger en liten riktig ONNX med `onnx.helper` (preprocessing/form/norm/batch + paritet); riktiga-vikter-integrationstestet är skipif-grindat. **Paritetslogiken verifierad** (adapter ⇄ referens-preprocessing bit-identisk, cosinus > 0,999 i test). **Öppen uppföljning:** live-jämförelsen LVFace-vs-buffalo på staging kunde inte köras i utvecklingssandboxen — HF:s fil-CDN (`us.aws.cdn.hf.co`, Xet) är nätverksblockerad där så vikterna inte gick att hämta; kör `python -m benchmarks.models.download lvface_base && python -m benchmarks.run <root> --models buffalo_l,lvface_base` på en nätansluten maskin för siffrorna.
- [x] **B5 — AdaFace IR-101-adapter** (auditplanens PR B5). Hårdfalls-/lågkvalitets-specialisten mot buffalo_l (OODFace: starkast på oskärpa/små ansikten). AdaFace saknar officiell ONNX (PyTorch-checkpoints) → extra exportsteg: `models/export_adaface.py` (nätansluten engångs-CLI: hämtar IR-101 WebFace12M-checkpoint från MIT HF-spegel `marcelo-victor/adaface_ir101_webface12m` eller `--checkpoint` för Google-Drive-originalet, bygger vendorad IR-101, exporterar ONNX opset 17 dynamisk batch endast embedding-huvudet, torch-vs-ONNX-paritet cosinus > 0,999, skriver sha256/licens/preprocessing/opset i manifestet; torch är export-tids-beroende endast, körs i scratch-venv), `models/_adaface_ir101_net.py` (vendorad IR-101-backbone, MIT © Minchul Kim, `ir`-läge, strict state_dict-laddning), `models/adaface.py` (`AdaFaceRecognition` via onnxruntime på kanonisk 112×112-crop; preprocessing **verifierad mot referensen** AdaFace `inference.py` `to_input` — nätet konsumerar **BGR**, så adaptern gör **ingen** kanalväxling, raka motsatsen mot LVFace). `run.py` tar nu `--models buffalo_l,lvface_base,adaface_ir101`. Enhetstester bygger liten riktig ONNX + paritetstest mot ordagrann `to_input`-port (naglar BGR-utan-swap). **Verifierat lokalt** (scratch-venv med torch): vendorad IR-101 bygger (65,15 M param = riktiga IR-101), ONNX-export + torch-vs-ONNX-paritet **cosinus 1,000000**, adapter-vs-`to_input` **cosinus 1,0**. **Öppen uppföljning (samma egress-blockering som B4):** riktiga vikter ej hämtbara i sandboxen (HF Xet-CDN blockerad); kör `python -m benchmarks.models.export_adaface && python -m benchmarks.run <root> --models buffalo_l,adaface_ir101` på nätansluten maskin för live-siffrorna (fyller även manifestets sha256-fält).
- [x] **B3+ — Slutkörning på full restore** — full-N-körning klar (`_data/report.md`, 2 923 matchade ansikten / 97 identiteter över buffalo_l/lvface_base/adaface_ir101, identiska detektioner+crops). Partiella siffror ersatta med full-N per stratum (Björneholt-tvillingparet, syskon-efternamnsgrupper, bbox-kvartiler). `det_size`-beslutet låst mot ground-truth-recall (behåll 640).
- [x] **Auditens slutrapport (beslutsdokument)** — [docs/dev/face-recognition-audit-2026-07.md](docs/dev/face-recognition-audit-2026-07.md) besvarar auditens fyra frågor med data. **Verdikt:** (1) behåll InsightFace; (2) migrera INTE modell (buffalo_l tar eller tangerar varje hård stratum, AdaFace vinner bara verifierings-AUC som inte översätts till identifiering); (3) **höj `match_threshold` 0,40 → 0,45** (app-nivå-svep visar att 0,40 lämnar ~6 % äkta ansikten omatchade utan precisionsvinst; par-nivåns 0,72-optimum gäller inte appen); (4) SCRFD + `det_size=640` behålls, tiling ej motiverad. Levererad supply-chain-tabell (manifest-sha256), reproduktionskommandon och begränsningar ingår.
- [x] **B6 — YOLO-face-detektoradapter + detektionsjämförelse mot SCRFD** (auditplanens PR B6). `models/yoloface.py` (`YoloFaceDetector`: onnxruntime-only, letterbox + avkodning + girig NMS + 5-punkts-landmärken i SCRFD-ordning; två ONNX-layouter autodetekterade — rå pose-head och NMS-bakad), `models/download.py` utökad (B4:s ModelSpec-design + valfria `url`/`kind`-fält för direkt-URL-hämtning, t.ex. GitHub-release-assets; checksumverifierat till `_data/models/<namn>/`; vald modell `yolov8n-face` från akanametov/yolo-face 1.0.0, AGPL-3.0 — endast lokalt benchmark-verktyg, buntas aldrig i appen), `detect_compare.py` (detektionsrecall per detektor, totalt + per bbox-area-kvartil + manual/detected, plus nyfunna-ansikten-räkning) och additiva `run.py`-modellposter (`yolov8n-face` + buffalo_l-igenkänningshuvud). Avkodning verifierad numeriskt mot SCRFD (box-IoU 0,77–0,97 på staging-bilder). Siffror på aktuell staging: se `backend/benchmarks/README.md` + PR:en.
- [ ] **B6+ — Större YOLO-variant + full pipeline på YOLO-detektioner.** `yolov8n-face` är nano-varianten (snabb iteration). Manifestet gör det trivialt att A/B:a större vikter (`yolov8l-face`, `yolov12*-face` finns i samma GitHub-release; kräver engångs-ONNX-export för rå-head) om nano-resultaten motiverar det. Kör också `benchmarks.run --models yolov8n-face` (YOLO-detektor → buffalo_l-igenkänning end-to-end) på full restore, och väg detektionsvinst mot appintegrationskostnad. **Låg prioritet:** detektionen är inte flaskhalsen (~99,8 % effektiv recall).

### Auditens uppföljningar (valfria, ej blockerande)

- [ ] **Höj `match_threshold` 0,40 → 0,45 i appen** (auditens enda handlingsbara kodändring). Egen liten PR: config-default + config-docs, kodifiera bandet 0,40–0,50 (0,40 = max-precision-golv, 0,45 = rekommenderad default, 0,50 = aggressiv). `ignore_distance` lämnas på 0,35 (styr den separata användarkurerade ignore-mängden, ej mätt här). Motivering och app-nivå-svep: [face-recognition-audit-2026-07.md §3](docs/dev/face-recognition-audit-2026-07.md).
- [ ] **FIQA enrollment-gating (valfri PR).** Grinda enrollment på ansiktsbildskvalitet så låg-kvalitetscrops aldrig hamnar i galleriet — en renare spak än att jaga de sista recall-punkterna.
- [ ] **CoreML/GPU-tidsmätning (valfri PR).** Nuvarande tider är CPU/ONNX och enbart informationella; mät den accelererade vägen innan några prestandapåståenden.
- [ ] **Öppen-mängd false-accept-svep vid operativ distans** — billig uppföljning om 0,50 (i stället för 0,45) önskas; nuvarande öppen-mängd-split är syntetisk.
- [ ] **Städa staging efter sign-off.** ~91 GB `benchmark_staging/` kan tas bort när slutrapporten är accepterad; körningen är reproducerbar från backup.

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

### InsightFace-version

Uppgraderad 0.7.3 → 1.0.1 (onnxruntime 1.27.0), grindad på embedding-stabilitet
och verifierad identisk (cosinus 1,000000, bbox-IoU 1,0) — se CHANGELOG och den
återkörbara grinden `backend/benchmarks/upgrade_compare.py`. **Fnotering om
`det_size`:** 1.0.1:s `prepare(det_thresh=0.5, det_size=None)` har en "Auto"-default
`det_size = [(128,128),(640,640)]` (dubbelskala med enad NMS). Auto är *inte* en
liten-ansikts-spak — 128-skalan är en *nedskalning* (grövre/snabbare detektion),
inte en uppskalning som skulle hitta fler små ansikten. Appen passerar avsiktligt
explicit `det_size=(640,640)`; byt inte till Auto i tron att det förbättrar
små-ansikts-recall.

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
