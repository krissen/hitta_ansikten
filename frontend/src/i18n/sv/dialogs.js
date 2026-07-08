// Swedish catalog namespace: dialogs
// Main-process UI text: splash/startup status lines, native dialog messages,
// and file-dialog filter names. "Servern" mirrors startupStatus for the backend.
module.exports = {
  "splash": {
    "startingBackend": "Startar servern…",
    "loadingInterface": "Laddar gränssnitt…",
    "ready": "Klar",
    "initializingPython": "Initierar Python…",
    "loadingModules": "Laddar Python-moduler…",
    "startingApi": "Startar FastAPI…",
    "startingWebServer": "Startar webbserver…",
    "waitingForBackend": "Väntar på servern… ({current}/{total})",
    "serverReady": "Servern redo"
  },
  "backendStartFailedSuggestion": "Kontrollera att Python är installerat och att ANSIKTEN_PYTHON pekar på rätt interpreter.",
  "selectFolders": "Välj mapp(ar) för att lägga till alla bilder",
  "filters": {
    "images": "Bilder",
    "rawImages": "RAW-bilder",
    "allImages": "Alla bilder",
    "allFiles": "Alla filer"
  }
};
