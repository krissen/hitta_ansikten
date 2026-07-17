// Swedish catalog namespace: fileQueue
module.exports = {
  "title": "Filkö",
  // Source-folder label in the header ({name} = folder basename).
  "sourceFolder": "Kö: {name}",
  "sourceFolderTitle": "Mappen som filkön hämtats från",

  "toggles": {
    "fixMode": "Fixläge",
    "showNewNames": "Visa nya namn"
  },

  "buttons": {
    "addFiles": "Lägg till filer",
    "addFolder": "Lägg till mapp",
    "sortQueue": "Sortera kön i bokstavsordning",
    "autoAdvanceOn": "Auto-avancera PÅ",
    "autoAdvanceOff": "Auto-avancera AV",
    "clearSelected": "Rensa valda",
    "clearSelectedTitle": "Rensa valda filer",
    "clearDone": "Rensa klara",
    "clearDoneTitle": "Rensa klara filer",
    "clearAll": "Rensa alla",
    "clearAllTitle": "Rensa alla filer ur kön",
    "renameSelected": "Byt namn ({count} valda)",
    "renameFiltered": "Byt namn ({count} filtrerade)",
    "rename": "Byt namn ({count})",
    "renameSelectedTitle": "Byt namn på valda filer",
    "renameFilteredTitle": "Byt namn på filtrerade filer",
    "renameTitle": "Byt namn på filer utifrån hittade ansikten",
    "renaming": "Byter namn…",
    "skip": "Hoppa över",
    "start": "Starta"
  },

  "filter": {
    "placeholder": "Filtrera…  a|b = eller  a&b = och",
    "clearTitle": "Rensa filter (Esc)"
  },

  "currentFile": {
    "scrollHint": "klicka för att rulla"
  },

  "item": {
    "ariaLabel": "{fileName}, {status}"
  },

  "emptyStates": {
    "noFiles": "Inga filer i kön",
    "addHint": "Klicka på + för att lägga till filer",
    "loadFolderOffer": "Ladda {name}?"
  },

  "preprocessing": {
    "buffered": "Buffrad",
    "bufferedTitle": "Förbehandling pausad – bufferten är full",
    "processing": "Bearbetar",
    "processingTitle": "Förbehandling pågår",
    "ready": "Redo",
    "readyTitle": "Alla filer förbehandlade"
  },

  "dropOverlay": "Släpp filer för att lägga till i kön",

  "status": {
    "done": "Klar",
    "active": "Aktiv",
    "error": "Fel",
    "notFound": "Hittas ej",
    "queuedReprocess": "I kö (behandla om)",
    "processed": "Behandlad",
    "queued": "I kö",
    "noPersons": "(inga personer)",
    "alreadyRenamed": "(redan namnbytt)"
  },

  "tooltips": {
    "file": "Fil:",
    "folder": "Mapp:",
    "detected": "Hittade:",
    "faceCount": {
      "one": "{count} ansikte",
      "other": "{count} ansikten"
    },
    "confirmed": "Bekräftade ({count}):",
    "newName": "Nytt namn:",
    "sidecars": "Sidofiler ({count}):",
    "rename": "Byt namn:",
    "fileNotFound": "Filen hittades inte",
    "cached": "Cachad",
    "preprocessingFailed": "Kunde inte förbehandla",
    "preprocessing": "Förbehandlar: {status}",
    "confirmedList": "Bekräftade: {names}",
    "detectedCount": { "one": "{count} ansikte hittat", "other": "{count} ansikten hittade" },
    "notLoaded": "Ej inläst",
    "reprocessFile": "Behandla om den här filen",
    "removeFromQueue": "Ta bort från kön"
  },

  "toasts": {
    "loadProcessedFailed": "⚠️ Kunde inte läsa in status för behandlade filer",
    "preprocessingFailed": "Kunde inte förbehandla {fileName}",
    "removedMissing": {
      "one": "Tog bort {count} saknad fil ur kön",
      "other": "Tog bort {count} saknade filer ur kön"
    },
    "preprocessingPaused": { "one": "Förbehandling pausad ({count} fil redo)", "other": "Förbehandling pausad ({count} filer redo)" },
    "preprocessingResumed": "Förbehandling återupptagen",
    "removedDeletedFile": "Tog bort raderad fil: {fileName}",
    "movedToTrash": "🗑️ Flyttade {fileName} till papperskorgen · ⌘⇧⌫ ångrar",
    "trashFailed": "Kunde inte flytta {fileName} till papperskorgen. Försök igen.",
    "restoredFromTrash": "↩️ Återställde {fileName} från papperskorgen",
    "nothingToDelete": "Ingen bild vald att ta bort",
    "nothingToUndo": "Inget att ångra",
    "preprocessingComplete": { "one": "Förbehandling klar ({count} fil cachad)", "other": "Förbehandling klar ({count} filer cachade)" },
    "backendReconnected": "🟢 Servern återansluten",
    "backendDisconnected": "🔴 Servern frånkopplad",
    "filesInQueue": "{total} filer i kön ({pending} väntar)",
    "cacheFull": "⚠️ Cache {percent}% full ({used}/{max} MB)",
    "allProcessed": "Alla filer är redan behandlade. Aktivera fixläge för att behandla om.",
    "noSupportedSkipped": "Inga bildfiler som stöds (hoppade över {count} filer som inte är bilder)",
    "addedFiles": {
      "one": "La till {count} fil i kön",
      "other": "La till {count} filer i kön"
    },
    "alreadyInQueueSuffix": " ({count} redan i kön)",
    "fileAlreadyInQueue": "Filen finns redan i kön",
    "allFilesAlreadyInQueue": "Alla {count} filer finns redan i kön",
    "queueSorted": "Kön sorterad i bokstavsordning",
    "loadingFileList": "Laddar fillista…",
    "fileAlreadyProcessed": "{fileName} är redan behandlad. Aktivera fixläge eller klicka på 🔄 för att behandla om.",
    "undid": "🔄 Ångrade {fileName}",
    "undoFailed": "Kunde inte ångra {fileName}",
    "reprocessing": "🔄 Behandlar om {fileName}",
    "reprocessFailed": "Kunde inte behandla om {fileName}",
    "generatingNames": "Skapar namnförslag för {count} filer…",
    "renaming": {
      "one": "Byter namn på {count} fil…",
      "other": "Byter namn på {count} filer…"
    },
    "renamed": {
      "one": "Bytte namn på {count} fil",
      "other": "Bytte namn på {count} filer"
    },
    "renamedSkippedSuffix": " · {count} hoppades över",
    "renamedErrorSuffix": " · {count} fel",
    "renameFailed": "Kunde inte byta namn: {message}",
    "savedReview": {
      "one": "Sparade granskning av {fileName} ({count} ansikte)",
      "other": "Sparade granskning av {fileName} ({count} ansikten)"
    },
    "saveReviewFailed": "Kunde inte spara granskning av {fileName}",
    "queueComplete": "🎉 Kön klar – alla filer granskade",
    "noSupportedFound": "Inga bildfiler som stöds hittades"
  },

  "dialogs": {
    "renameConfirm": {
      "one": "Byt namn på {count} fil{selection}?\n\nDetta byter namn på filer utifrån hittade ansikten.\nSe Inställningar för namnformat.",
      "other": "Byt namn på {count} filer{selection}?\n\nDetta byter namn på filer utifrån hittade ansikten.\nSe Inställningar för namnformat."
    },
    "renameConfirmSelection": " (valda)"
  }
};
