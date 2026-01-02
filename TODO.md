# TODO - Hitta ansikten

Konsoliderad lista över planerade förbättringar, kända brister och teknisk skuld.

**Senast uppdaterad:** 2026-01-02

---

## Roadmap

### Kort sikt

- [ ] **N-tangent för reprocess** - Reprocess aktuellt ansikte med högre upplösning i ReviewModule
- [ ] **Drag-and-drop polish** - Förbättra DnD-upplevelsen i FileQueueModule

### Mellan sikt

- [ ] **Backend distance-optimering** - Optimera distansberäkningar för bättre prestanda
- [ ] **Duplicate cleanup tool** - Verktyg för att hitta och hantera duplicerade ansikten i databasen
- [ ] **Tab maximization** - Möjlighet att maximera en tab tillfälligt
- [ ] **Floating windows** - Stöd för fristående fönster för moduler

### Lång sikt

- [ ] **Plugin-system** - Utökningsbart system för tredjepartsmoduler
- [ ] **Remote database sync** - Synkronisering av databas över nätverk
- [ ] **Multi-user support** - Stöd för flera användare att arbeta samtidigt

---

## Kända brister

### Dokumentation

- [ ] ~~SESSION_SUMMARY.md refereras men finns inte~~ (fixad i doc-overhaul)
- [ ] WebSocket var dokumenterad som "Future" men är implementerat
- [ ] Saknas komplett lista över keyboard shortcuts i en fil
- [ ] Inkonsistent språk (svenska/engelska) i kodbas och docs

### Funktionalitet

- [ ] Ingen testsvit - enhets- och integrationstester saknas helt
- [ ] Ingen deployment-guide för att bygga och distribuera
- [ ] Saknas felhantering vid nätverksavbrott mot backend
- [ ] Preview-bilder cachas inte effektivt

### UI/UX

- [ ] Inga visuella indikatorer för tangentbordsgenvägar i UI
- [ ] Saknas undo/redo för ansiktsbekräftelser
- [ ] Toast-meddelanden kan inte klickas bort manuellt
- [ ] Ingen progress-indikator för långsamma operationer

---

## Teknisk skuld

### Backend

- [ ] `hitta_ansikten.py` är 2000+ rader - bör brytas upp
- [ ] Ingen typ-annotation i äldre Python-kod
- [ ] Inkonsekvent error-handling (print vs logging)
- [ ] Preprocessing-cache kan växa obegränsat

### Frontend

- [ ] Vissa moduler har duplicerad state-hantering
- [ ] WebSocket-reconnect-logik kan förbättras
- [ ] Bundle-storlek (~450kb) kan minskas med tree-shaking
- [ ] Flera `useEffect` utan cleanup-funktioner

### Arkitektur

- [ ] Backend och frontend har ingen gemensam typdefinition
- [ ] API-versioning saknas
- [ ] Ingen health-check endpoint för backend
- [ ] Loggning är inkonsekvent mellan backend/frontend

---

## Slutfört (referens)

### 2026-01-02: Styling och tema-system
- [x] `theme.css` med CSS-variabler (light/dark mode)
- [x] `theme-manager.js` för tema-byte (light/dark/system)
- [x] Alla CSS-filer migrerade till CSS-variabler
- [x] ThemeEditor-modul med preset-bibliotek
- [x] PreferencesModule som FlexLayout-modul
- [x] Icon-komponent med SVG-ikoner (ersätter emoji)
- [x] Fix `--text-inverse` kontrastproblem

### 2026-01-01: Database Management
- [x] Komplett paritet med `hantera_ansikten.py`
- [x] Rename/Merge/Delete person
- [x] Move to/from ignored
- [x] Undo file processing
- [x] Purge encodings

### 2025-12: Match Alternatives
- [x] Backend returnerar top-N matchningsalternativ
- [x] Siffertangenter 1-N väljer alternativ
- [x] Ignore-matchningar i alternativlistan
- [x] Konfigurerbart antal alternativ

### 2025-12: File Queue
- [x] FileQueueModule med status-indikatorer
- [x] Auto-advance efter review
- [x] Fix-mode för re-review
- [x] Preprocessing-pipeline
- [x] Rename-funktionalitet

---

## Anteckningar

### Projektnamnbyte
Projektet heter **Hitta ansikten**. "Bildvisare" var ett tidigare namn som inte längre används.

### Prioritering
- **P1** - Blockerar arbetsflöde
- **P2** - Förbättrar produktivitet
- **P3** - Nice-to-have

### Kontribuera
Se [docs/dev/contributing.md](docs/dev/contributing.md) för hur du bidrar.
