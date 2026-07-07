// Swedish catalog namespace: culling
module.exports = {
  "filterBar": {
    "addFolder": "+ Mapp",
    "fileType": "Filtyp",
    "player": "Spelare",
    "allPlayers": "Alla spelare",
    "globPlaceholder": "Glob, t.ex. *ArvidW*",
    "show": "Visa",
    "loading": "…",
    "grid": "Rutnät",
    "trash": "Papperskorg",
    "presets": {
      "jpg": "jpg / jpeg",
      "nef": "nef",
      "raw": "raw (alla)"
    },
    "gridToggleTitle": {
      "toSingle": "Visa enkelbild",
      "toGrid": "Visa översikt (rutnät)"
    }
  },
  "roots": {
    "removeFolder": "Ta bort mapp {name}"
  },
  "list": {
    "label": "Bildlista",
    "count": "{count} bilder",
    "playerSuffix": " · {player}"
  },
  "empty": {
    "pickFolder": "Välj mapp + spelare/glob och tryck",
    "noImages": "Inga bilder.",
    "noImageSelected": "Ingen bild vald."
  },
  "preview": {
    "converting": "Konverterar…",
    "loading": "Läser in…"
  },
  "names": {
    "restore": "Lägg tillbaka {name}",
    "remove": "Ta bort {name}",
    "hintRename": "döp om",
    "hintUndo": "ångra"
  },
  "confirmNav": {
    "title": "Osparade namnändringar",
    "save": "Spara",
    "discard": "Kasta",
    "cancel": "Avbryt"
  },
  "contextMenu": {
    "previous": "Föregående",
    "next": "Nästa",
    "jumpBack": "Hoppa bakåt",
    "jumpForward": "Hoppa framåt",
    "rename": "Byt namn",
    "cull": "Gallra",
    "undoLast": "Ångra senaste",
    "openInLightroom": "Öppna i Lightroom"
  },
  "grid": {
    "overviewLabel": "Miniatyröversikt"
  },
  "stats": {
    "header": "Spelare",
    "baselineTitle": "Baslinje (median)",
    "empty": "—",
    "columns": {
      "name": "Namn",
      "count": "Antal",
      "pct": "%",
      "delta": "Δ%",
      "distribution": "Fördelning"
    },
    "excludedLabels": {
      "tranare": "Tränare",
      "grupp": "Gruppbilder",
      "publik": "Publik",
      "below_threshold": "Under tröskeln"
    },
    "groupSummary": "{label} ({count})",
    "excludedItem": "{name}: {count} ({pct}%)",
    "rowTitle": {
      "count": "{name}: {count}",
      "gridSelect": "Markera {name} · dubbelklicka för att filtrera",
      "loupeFilter": "Filtrera på {name}"
    }
  },
  "errors": {
    "trashFailed": "Kunde inte flytta filen till papperskorgen.",
    "nefNotFound": "Ingen NEF hittad för {token} i {rawRoot}",
    "noTimestamp": "Kunde inte härleda tidsstämpel ur filnamnet",
    "scanError": "Kunde inte söka i RAW-mappen {rawRoot}{detail}",
    "unsupportedPlatform": "Öppna i Lightroom stöds bara på macOS",
    "lightroomFailed": "Kunde inte öppna i Lightroom{detail}",
    "fileNotFound": "Filen hittades inte.",
    "fileUnreadable": "Filen kunde inte läsas.",
    "nefConvertFailed": "Kunde inte konvertera NEF.",
    "imageLoadFailed": "Kunde inte läsa in bilden."
  }
};
