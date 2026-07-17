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

Allt förberedande arbete sker på **dev**; master uppdateras enbart via en
release-PR som mergas in. Feature-PR:er har redan granskats var för sig, så
release-PR:en behöver ingen ny bot-reviewrunda.

### 1. Förbered på dev (prep-commit)

Säkerställ att du står på `dev` med senaste ändringar och att allt bygger:

```bash
git checkout dev
git pull origin dev

cd frontend
npm run build:workspace
npx electron .
```

Gör sedan releaseförberedelsen i **en** commit:

1. **Roadmap → Changelog.** Flytta klara punkter från [`ROADMAP.md`](../../ROADMAP.md)
   (löpande backlog/known issues/teknisk skuld; release-scopade prestandaplaner
   ligger i [`docs/dev/performance-plan.md`](performance-plan.md)) till
   `CHANGELOG.md` och finslipa dem. Det här håller roadmap framåtblickande och
   changelog release-fokuserad.
2. **Byt `[Unreleased]`-rubriken** till version + datum, t.ex.
   `## [1.7.0] - 2026-07-17`. Innehållet under rubriken lämnas oförändrat.
3. **Bumpa alla tre versionsnummer** till samma nummer som den kommande taggen:
   - `frontend/package.json` → `version`
   - `backend/pyproject.toml` → `version`
   - `backend/api/server.py` → `version=` i `FastAPI(...)` (exponeras via
     `/health`; se ROADMAP för den kända dubbleringen)

   Vid release-bygget är **`v*`-taggen auktoritativ** för frontend-versionen:
   workflow-steget "Set version from tag" kör
   `npm pkg set version=${GITHUB_REF_NAME#v}`, så `frontend/package.json` skrivs
   över med taggens nummer i CI. De committade versionsnumren används alltså inte
   av frontend-bygget — men de ska ändå hållas i synk så att fristående
   backend-körning och `/health` rapporterar rätt.

Committa som en enda prep-commit:

```
(release) Prepare vX.Y.Z: changelog + version bump
```

### 2. Öppna release-PR dev → master

Öppna en PR från `dev` till `master` med titeln `Release vX.Y.Z` och minst en
label (t.ex. `enhancement`) — **CI nekar PR:er utan label**:

```bash
gh pr create --base master --head dev \
  --title "Release vX.Y.Z" \
  --label enhancement \
  --body "Release vX.Y.Z. Se CHANGELOG.md."
```

Ingen ny bot-reviewrunda behövs — innehållet är redan granskat per feature-PR.
Merga PR:en som **mergecommit** (inte squash), så master behåller den fulla
historiken:

```bash
gh pr merge --merge
```

### 3. Skapa och pusha tag på master

Den annoterade taggen sätts på **mergecommiten på master** och pushas — det är
pushen som triggar Release-workflowen:

```bash
git checkout master
git pull origin master

git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
```

> **Viktigt:** Taggen måste börja med `v` (t.ex. `v1.7.0`, inte `1.7.0`).

### 4. Övervaka bygget

1. Gå till [GitHub Actions](https://github.com/krissen/ansikten/actions)
2. Klicka på "Release" workflow
3. Vänta på att alla tre byggjobb (macOS, Windows, Linux) blir gröna

Byggtider (ungefärliga):
- macOS: ~8 minuter
- Windows: ~10 minuter
- Linux: ~6 minuter

### 5. Publicera release

1. Gå till [GitHub Releases](https://github.com/krissen/ansikten/releases)
2. Hitta draft-releasen (skapad automatiskt)
3. Skriv release notes i `## Highlights`-format: en punktlista med de viktigaste
   ändringarna sedan förra releasen, var och en med sitt PR-nummer, avslutad med
   en länk till `CHANGELOG.md` på master för fullständig lista. Använd releasen
   [v1.6.0](https://github.com/krissen/ansikten/releases) som förlaga.
4. Klicka "Publish release"

### 6. Installera lokalt (macOS)

Efter publicering installeras releasen till `/Applications`. `bin/ansikten`-CLI:t
pekar på `/Applications/Ansikten.app`, så detta steg krävs för att CLI:t ska köra
den nya versionen — det ingår **alltid** i att släppa en release:

```bash
gh release download vX.Y.Z -p 'Ansikten-X.Y.Z-arm64.dmg' -D /tmp
# Avsluta ev. körande Ansikten först
hdiutil attach /tmp/Ansikten-X.Y.Z-arm64.dmg -nobrowse
rm -rf /Applications/Ansikten.app
cp -R "/Volumes/Ansikten X.Y.Z-arm64/Ansikten.app" /Applications/   # kontrollera volymnamnet med ls /Volumes
hdiutil detach "/Volumes/Ansikten X.Y.Z-arm64"
defaults read /Applications/Ansikten.app/Contents/Info.plist CFBundleShortVersionString  # ska visa X.Y.Z
```

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
