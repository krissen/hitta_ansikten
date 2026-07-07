// Swedish catalog namespace: review
module.exports = {
  "placeholder": "Personnamn…",
  "ignoredBadge": "Ignorerad",
  "unknown": "Okänd",
  "noFacesDetected": "Inga ansikten identifierade",
  "noFacesHint": "Bilden kan ändå döpas – lägg till ett namn manuellt.",
  "addManualName": "Lägg till namn manuellt",
  "undoTitle": "Dubbelklicka för att ångra",

  "badges": {
    "manual": "Manuellt tillagd",
    "probableIgnore": "Trolig ignorering",
    "uncertainIgn": "ign ({conf}%) / {name}",
    "uncertainName": "{name} / ign ({conf}%)"
  },

  "twinDisambig": {
    "label": "Tvilling-särskiljning → {chosen}",
    "title": "Lika ansikten {between} — valt via k-NN-röstning över bekräftade foton"
  },

  "queueBar": {
    "title": "{done} granskade · {preprocessed} redo · {remaining} kvar"
  },

  "status": {
    "waitingForImage": "Väntar på bild…",
    "detecting": "Identifierar ansikten...",
    "detectionFailed": "Identifiering misslyckades",
    "detectionCancelled": "Identifiering avbruten",
    "connectionError": "Anslutningsfel",
    "found": {
      "one": "Hittade {count} ansikte ({ms}ms)",
      "other": "Hittade {count} ansikten ({ms}ms)"
    },
    "accepted": "Godkände {accepted}, ignorerade {ignored}",
    "acceptedSkippedSuffix": ", hoppade över {skipped}",
    "saving": {
      "one": "Sparar {count} ändring…",
      "other": "Sparar {count} ändringar…"
    },
    "saved": {
      "one": "Sparade {count} ändring",
      "other": "Sparade {count} ändringar"
    },
    "saveError": "Fel vid sparande – granskningen markerades INTE som klar",
    "changesDiscarded": "Ändringar kasserade",
    "imageSkipped": "Bild överhoppad",
    "manualFaceAdded": "Manuellt ansikte tillagt – ange namn",
    "reviewProgress": "{reviewed}/{total} granskade | {pending} väntar",
    "alreadyProcessed": "Redan behandlad – klicka på 🔄 för att behandla om"
  },

  "toasts": {
    "noFacesFound": "Inga ansikten hittades i {fileName}",
    "backendUnreachable": "Servern kan inte nås",
    "undo": "Ångra: {label}",
    "undoConfirmFallback": "bekräfta",
    "undoIgnore": "Ångra: ignorera"
  },

  "manualSuffix": {
    "title": "Filnamnstillägg",
    "placeholder": "t.ex. vinbär",
    "previewLabel": "Nytt namn:",
    "hint": "_ för mellanslag, å/ä→a, ö→o",
    "saved": "Filnamnstillägg sparat",
    "cleared": "Filnamnstillägg borttaget",
    "saveError": "Kunde inte spara filnamnstillägg"
  },

  "dialog": {
    "confirmNameChange": "Bekräfta namnändring",
    "confirmIgnore": "Bekräfta ignorering",
    "bestMatch": "Bästa träff:",
    "nameMismatch": "Du valde ”{name}” istället. Är du säker?",
    "ignoreConfirm": "Du valde att ignorera det här ansiktet. Är du säker?",
    "hintConfirms": "bekräftar",
    "hintCancels": "avbryter",
    "discardConfirm": {
      "one": "Kasta {count} osparad ändring?",
      "other": "Kasta {count} osparade ändringar?"
    }
  }
};
