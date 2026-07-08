// Swedish catalog namespace: database
module.exports = {
  "title": "Databashantering",
  "sections": {
    "currentDatabase": "Aktuell databas",
    "operations": "Åtgärder"
  },
  "buttons": {
    "reload": "Ladda om databasen",
    "rename": "Byt namn",
    "merge": "Slå samman",
    "find": "Hitta",
    "scan": "Sök",
    "scanning": "Söker…",
    "cleanAll": "Rensa alla",
    "clean": "Rensa",
    "keep": "Behåll {name}",
    "notADuplicate": "Inte en dubblett",
    "delete": "Radera",
    "moveToIgnore": "Flytta till ignorerade",
    "move": "Flytta",
    "undo": "Ångra",
    "showRecentFiles": "Visa senaste filer",
    "purge": "Rensa"
  },
  "labels": {
    "threshold": "Tröskel"
  },
  "stats": {
    "loading": "Laddar…",
    "loadFailedInline": "Kunde inte ladda",
    "people": "personer,",
    "ignored": "ignorerade",
    "filesProcessed": "filer bearbetade",
    "backends": "Motorer: "
  },
  "placeholders": {
    "filterNames": "Filtrera namn…",
    "currentName": "Nuvarande namn",
    "newName": "Nytt namn",
    "firstPerson": "Första personen",
    "secondPerson": "Andra personen",
    "resultName": "Resultatnamn (valfritt)",
    "personToDelete": "Person att radera",
    "personName": "Personnamn",
    "countAll": "Antal (-1 för alla)",
    "newPersonName": "Nytt personnamn",
    "filenameGlob": "Filnamn eller mönster (t.ex. 2024*.NEF)",
    "personOrIgnore": "Person eller 'ignore'",
    "count": "Antal"
  },
  "emptyStates": {
    "noMatches": "Inga träffar",
    "noDuplicates": "Inga dubblettkandidater vid denna tröskel.",
    "noRedundant": "Inga överflödiga kodningar vid denna tröskel.",
    "noRecentFiles": "Inga bearbetade filer"
  },
  "ops": {
    "rename": { "title": "1. Byt namn på person" },
    "merge": { "title": "2. Slå samman personer" },
    "findDuplicates": {
      "title": "Hitta dubbletter",
      "separable": "separerbar {percent} %",
      "likelyDistinct": "→ sannolikt olika",
      "excludedPairs": "Uteslutna par ({count})"
    },
    "redundant": {
      "title": "Ta bort överflödiga kodningar",
      "redundantCount": {
        "one": "{count} överflödig",
        "other": "{count} överflödiga"
      }
    },
    "delete": { "title": "3. Radera person" },
    "moveToIgnore": { "title": "4. Flytta till ignorerade" },
    "moveFromIgnore": { "title": "5. Flytta från ignorerade" },
    "undo": { "title": "8/10. Ångra filbearbetning" },
    "purge": { "title": "9. Rensa senaste X kodningar" }
  },
  "tooltips": {
    "centroidDistance": "Centroidavstånd {distance}",
    "notADuplicate": "Detta är olika personer som liknar varandra (t.ex. tvillingar); föreslå aldrig att de slås samman",
    "allowSuggestAgain": "Tillåt att detta par föreslås igen",
    "redundantThreshold": "0 = endast exakta dubbletter; högre värden tar även bort nästan identiska kodningar"
  },
  "misc": {
    "allBackends": "Alla motorer",
    "backendOnly": " (endast {backend})",
    "all": "alla",
    "peopleCount": "{count} personer",
    "person": {
      "one": "person",
      "other": "personer"
    }
  },
  "toasts": {
    "loadFailed": "Kunde inte ladda databasens tillstånd: {error}",
    "enterBothNames": "Ange både gammalt och nytt namn",
    "renameFailed": "Kunde inte byta namn: {error}",
    "enterTwoPeople": "Ange två personer att slå samman",
    "mergeFailed": "Kunde inte slå samman: {error}",
    "foundDuplicates": {
      "one": "Hittade {count} dubblettkandidat bland {people} personer (≤ {threshold})",
      "other": "Hittade {count} dubblettkandidater bland {people} personer (≤ {threshold})"
    },
    "duplicateScanFailed": "Kunde inte söka efter dubbletter: {error}",
    "excludePairFailed": "Kunde inte utesluta paret: {error}",
    "markedNotDuplicate": "Markerade ”{a}” och ”{b}” som inte en dubblett",
    "removeExclusionFailed": "Kunde inte ta bort uteslutningen: {error}",
    "foundRedundant": {
      "one": "{count} överflödig kodning bland {people} {peopleWord} (≤ {threshold})",
      "other": "{count} överflödiga kodningar bland {people} {peopleWord} (≤ {threshold})"
    },
    "redundancyScanFailed": "Kunde inte söka efter överflödiga kodningar: {error}",
    "dedupFailed": "Kunde inte ta bort de överflödiga kodningarna: {error}",
    "enterPersonToDelete": "Ange namn på person att radera",
    "deleteFailed": "Kunde inte radera personen: {error}",
    "enterPersonName": "Ange personnamn",
    "moveToIgnoreFailed": "Kunde inte flytta till ignorerade: {error}",
    "enterCountAndTarget": "Ange antal och målnamn",
    "moveFromIgnoreFailed": "Kunde inte flytta från ignorerade: {error}",
    "enterFilenamePattern": "Ange filnamn eller mönster",
    "filesUndone": "Filer: ",
    "undoFailed": "Kunde inte ångra: {error}",
    "recentFilesFailed": "Kunde inte ladda senaste filer: {error}",
    "enterPersonAndCount": "Ange personnamn och antal",
    "purgeFailed": "Kunde inte ta bort kodningarna: {error}"
  },
  "dialogs": {
    "renameConfirm": "Byt namn på ”{old}” till ”{new}”?",
    "mergeConfirm": "Slå samman ”{source1}” och ”{source2}” till ”{target}”{backendDesc}?",
    "mergePairConfirm": "Slå samman ”{drop}” till ”{keep}”?",
    "dedupConfirm": {
      "one": "Ta bort {count} överflödig kodning från {who}? Detta kan inte ångras.",
      "other": "Ta bort {count} överflödiga kodningar från {who}? Detta kan inte ångras."
    },
    "deleteConfirm": "Radera ”{name}”? Detta tar bort alla deras kodningar permanent.",
    "moveToIgnoreConfirm": "Flytta ”{name}” till ignorerade{backendDesc}?",
    "moveFromIgnoreConfirm": "Flytta {count} kodningar från ignorerade till ”{target}”{backendDesc}?",
    "undoConfirm": "Ångra bearbetning för filer som matchar ”{pattern}”?",
    "recentFilesTitle": "Senaste bearbetade filer",
    "purgeConfirm": "Ta bort de senaste {count} kodningarna från ”{name}”{backendDesc}? Detta kan inte ångras."
  }
};
