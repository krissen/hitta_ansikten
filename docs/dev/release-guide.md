# Release-guide

Guide för att skapa och publicera nya versioner av Ansikten.

---

## Översikt

Releaser triggas automatiskt via GitHub Actions när en version-tag pushas.

```
git tag v1.0.0 → GitHub Actions → Bygg → Draft release
```

---

## Versioneringsstrategi

Projektet använder [Semantic Versioning](https://semver.org/):

| Typ | Beskrivning | Exempel |
|-----|-------------|---------|
| **Major** | Breaking changes | v2.0.0 |
| **Minor** | Nya funktioner | v1.1.0 |
| **Patch** | Buggfixar | v1.0.1 |

---

## Release-process

### 1. Förbered koden

```bash
# Säkerställ att du är på master med senaste ändringar
git checkout master
git pull origin master

# Verifiera att allt bygger lokalt
cd frontend
npm run build:workspace
npx electron .
```

### 2. Roadmap -> Changelog (obligatoriskt)

Arbetsprincip för planering och releaseförberedelse:

1. Planera framtida arbete i [`ROADMAP.md`](../../ROADMAP.md) (löpande backlog/known issues/teknisk skuld); release-scopade prestandaplaner ligger i [`docs/dev/performance-plan.md`](performance-plan.md)
2. När arbete är klart inför release, flytta relevanta punkter från roadmap till `CHANGELOG.md`
3. Finslipa `CHANGELOG.md` så den beskriver ändringarna sedan senaste tag

Det här håller roadmap framåtblickande och changelog release-fokuserad.

### 3. Uppdatera versionsnummer (bumpa båda)

Vid release-bygget är **`v*`-taggen auktoritativ** för frontend-versionen:
workflow-steget "Set version from tag" kör `npm pkg set version=${GITHUB_REF_NAME#v}`,
så `frontend/package.json` skrivs över med taggens nummer i CI. De committade
versionsnumren i repot används alltså inte av frontend-bygget — men de ska ändå
hållas i synk så att fristående backend-körning och `/health` rapporterar rätt.

Bumpa därför **båda** committade versionerna tillsammans, till samma nummer som taggen:

- `frontend/package.json` → `version`
- `backend/pyproject.toml` → `version` (och `version=` i `backend/api/server.py`,
  som exponeras via `/health`; se ROADMAP för den kända dubbleringen)

### 4. Skapa och pusha tag

```bash
# Skapa annoterad tag
git tag -a v1.0.1 -m "Release v1.0.1"

# Pusha tag till GitHub
git push origin v1.0.1
```

> **Viktigt:** Taggen måste börja med `v` (t.ex. `v1.0.1`, inte `1.0.1`).

### 5. Övervaka bygget

1. Gå till [GitHub Actions](https://github.com/krissen/ansikten/actions)
2. Klicka på "Release" workflow
3. Vänta på att alla tre byggjobb (macOS, Windows, Linux) blir gröna

Byggtider (ungefärliga):
- macOS: ~8 minuter
- Windows: ~10 minuter
- Linux: ~6 minuter

### 6. Publicera release

1. Gå till [GitHub Releases](https://github.com/krissen/ansikten/releases)
2. Hitta draft-releasen (skapad automatiskt)
3. Lägg till release notes
4. Klicka "Publish release"

---

## Byggartifakter

GitHub Actions genererar följande filer:

| Plattform | Filformat | Storlek (ca) |
|-----------|-----------|--------------|
| macOS | `.dmg`, `.zip` | ~500 MB |
| Windows | `.exe` (NSIS) | ~500 MB |
| Linux | `.deb`, `.AppImage` | ~500 MB |

---

## Felsökning

### Bygget misslyckas

**Python-beroenden:**
```bash
# Kontrollera att pyproject.toml är uppdaterad
cd backend
pip install -e ".[build]"
pyinstaller ansikten-backend.spec
```

**Node-beroenden:**
```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
npm run build:workspace
```

### Ta bort och pusha om tag

Om du behöver göra en ny release med samma versionsnummer:

```bash
# Ta bort lokal tag
git tag -d v1.0.1

# Ta bort remote tag
git push origin :refs/tags/v1.0.1

# Skapa och pusha ny tag
git tag -a v1.0.1 -m "Release v1.0.1"
git push origin v1.0.1
```

### Rollback

Om en release har problem:

1. Ta bort releasen från GitHub Releases
2. Ta bort taggen (se ovan)
3. Fixa problemet
4. Skapa ny release

---

## Lokal testbygge

Testa byggprocessen lokalt innan du pushar:

```bash
# Backend
cd backend
pip install pyinstaller
pyinstaller ansikten-backend.spec
ls dist/ansikten-backend/

# Frontend
cd frontend
npm run build:workspace
npm run build:mac  # eller build:win, build:linux
```

---

## CI/CD-konfiguration

Workflow-filen: `.github/workflows/release.yml`

**Miljövariabler:**
- `NODE_VERSION`: 20
- `PYTHON_VERSION`: 3.11

**Hemliga nycklar:**
- `GITHUB_TOKEN`: Automatisk, används för att skapa release

**Caching:**
- pip-cache för Python-beroenden
- npm-cache för Node-beroenden
- Electron-cache för snabbare byggen

---

## Se även

- [Building](building.md) - Detaljerad byggdokumentation
- [Contributing](contributing.md) - Bidragsguide
- [Roadmap](roadmap.md) - Planerad utveckling framåt
