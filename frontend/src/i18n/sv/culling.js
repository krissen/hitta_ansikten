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
    "noImages": "Inga bilder matchade. Ändra urval och tryck Visa igen.",
    "noImageSelected": "Välj en bild i listan för att visa den här."
  },
  "preview": {
    "converting": "Konverterar…",
    "loading": "Läser in…"
  },
  "names": {
    "restore": "Lägg tillbaka {name}",
    "remove": "Ta bort {name}",
    "hintRename": "byt namn",
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
    "baselineTitle": "Baslinjevärde",
    "baselineSelectTitle": "Baslinje: referens för över-/underrepresentation",
    "baselineSelectLabel": "Baslinje",
    "baselineMedian": "Median",
    "baselineMean": "Medel",
    "minImagesLabel": "Min bilder",
    "minImagesTitle": "Minsta antal bilder för att räknas som spelare",
    "empty": "—",
    "columns": {
      "name": "Namn",
      "count": "Antal",
      "pct": "%",
      "delta": "Δ%",
      "distribution": "Fördelning"
    },
    "deltaTitle": "Avvikelse från baslinjen — medianen eller medelvärdet av bildantalet för de inkluderade spelarna. Positivt = fler bilder än baslinjen, negativt = färre.",
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
    "trashFailed": "Kunde inte flytta filen till papperskorgen. Försök igen.",
    "nefNotFound": "Ingen NEF hittad för {token} i {rawRoot}",
    "noTimestamp": "Kunde inte härleda tidsstämpel ur filnamnet",
    "scanError": "Kunde inte söka i RAW-mappen {rawRoot}{detail}",
    "unsupportedPlatform": "Öppna i Lightroom stöds bara på macOS",
    "lightroomFailed": "Kunde inte öppna i Lightroom{detail}",
    "fileNotFound": "Filen hittades inte. Den kan ha flyttats eller tagits bort.",
    "fileUnreadable": "Filen kunde inte läsas. Kontrollera att den finns och inte används av ett annat program.",
    "nefConvertFailed": "Kunde inte konvertera NEF-filen.",
    "imageLoadFailed": "Kunde inte läsa in bilden."
  }
};
