// Swedish catalog namespace: preferences
module.exports = {
  "sidebarTitle": "Inställningar",
  "sections": {
    "general": "Allmänt",
    "layout": "Layout",
    "image-viewer": "Bildvisare",
    "review": "Granska",
    "files": "Filer",
    "preprocessing": "Förbehandling",
    "dashboard": "Statistik",
    "advanced": "Avancerat"
  },
  "dialogs": {
    "resetConfirm": "Återställ alla inställningar till standard? Dina osparade ändringar går förlorade. Inget skrivs förrän du klickar på Spara.",
    "clearCacheConfirm": "Rensa all cachad förbehandlingsdata? Cachen byggs upp igen nästa gång filer förbehandlas.",
    "clearCacheConfirmLabel": "Rensa cache"
  },
  "toasts": {
    "clearCacheError": "Kunde inte rensa förbehandlingscachen. Kontrollera att servern är igång och försök igen.",
    "trashRetentionError": "Kunde inte spara papperskorgens tömningsgräns. Kontrollera att servern är igång och försök igen."
  },
  "buttons": {
    "clearCache": "Rensa förbehandlingscache",
    "resetDebugCategories": "Återställ felsökningskategorier till standard"
  },
  "general": {
    "backendHeader": "Serverinställningar",
    "autoStart": "Starta servern automatiskt",
    "port": {
      "label": "Serverport",
      "hint": "Standard: 5001. Kräver omstart av appen."
    },
    "pythonPath": {
      "label": "Python-sökväg",
      "hint": "Sökväg till Python-tolken. Kräver omstart av appen."
    },
    "uiHeader": "Användargränssnitt",
    "theme": {
      "label": "Tema",
      "hint": "Applikationens färgtema.",
      "dark": "Mörkt (CRT Phosphor)",
      "light": "Ljust (Terminal Beige)",
      "system": "Följ system"
    },
    "defaultLayout": {
      "label": "Standardlayout",
      "standard": "Standard",
      "compact": "Kompakt (kommande)",
      "reviewFocused": "Granskningsfokuserad (kommande)"
    },
    "showWelcome": "Visa välkomstmeddelande vid start"
  },
  "layout": {
    "header": "Standardlayout",
    "showWorkflowBar": {
      "label": "Visa arbetsflödesrad",
      "hint": "Visa den fasta raden med pipeline-stegen ovanför arbetsytan."
    },
    "template": {
      "label": "Standardmall för layout",
      "hint": "Layout som används vid återställning eller första start.",
      "review": "Granskningsläge",
      "comparison": "Jämförelseläge",
      "fullImage": "Helbild",
      "stats": "Statistikläge"
    },
    "gridPreset": {
      "label": "Standardförval för rutnät",
      "hint": "Standardförhållande för panelstorlek i nya layouter."
    },
    "autoSave": {
      "label": "Spara layout automatiskt vid ändringar",
      "hint": "Spara panelpositioner och -storlekar automatiskt när de ändras."
    },
    "rememberSizes": {
      "label": "Kom ihåg panelstorlekar mellan sessioner",
      "hint": "Återställ exakta panelmått vid återöppning."
    }
  },
  "imageViewer": {
    "header": "Bildvisare",
    "zoomSpeed": {
      "label": "Zoomhastighet",
      "hint": "Zoommultiplikator per steg (1.07 = 7 % per steg)"
    },
    "maxZoom": "Maximal zoom",
    "minZoom": "Minimal zoom",
    "zoomMode": {
      "label": "Standardzoomläge",
      "autoFit": "Anpassa automatiskt (till fönster)",
      "oneToOne": "1:1 (verklig storlek)"
    },
    "smoothPan": "Mjuk panoreringsanimering"
  },
  "review": {
    "header": "Granskningsmodul",
    "autoSave": "Spara automatiskt när alla ansikten granskats",
    "confirmBeforeSave": "Fråga om bekräftelse innan sparande",
    "action": {
      "label": "Åtgärd efter bekräftat ansikte",
      "next": "Gå till nästa ansikte",
      "stay": "Stanna på aktuellt ansikte"
    },
    "showConfidence": "Visa säkerhetspoäng",
    "saveMode": {
      "label": "Sparläge",
      "hint": "Hur granskningsresultat skrivs till databasen",
      "perImage": "Per bild (spara alla ansikten för varje bild)",
      "perFace": "Per ansikte (spara varje ansikte direkt)"
    },
    "matchAlternatives": {
      "label": "Matchningsalternativ",
      "hint": "Antal matchningsförslag att visa (1–9). Tryck på siffertangenter för att välja."
    }
  },
  "files": {
    "cullingHeader": "Gallring / Lightroom",
    "rawRoot": {
      "label": "RAW-mapp (NEF)",
      "hint": "Rot som söks rekursivt för original-NEF vid 'Öppna i Lightroom' (tangent L) i Gallra spelare. ~/ tillåtet."
    },
    "queueHeader": "Filkö",
    "autoLoad": {
      "label": "Ladda automatiskt från kön vid start",
      "hint": "Ladda automatiskt första väntande filen när appen startar"
    },
    "autoRemove": {
      "label": "Ta bort saknade filer automatiskt",
      "hint": "Ta automatiskt bort filer ur kön om de inte längre finns"
    },
    "insertMode": {
      "label": "Infogningsläge",
      "hint": "Hur nya filer läggs till i kön",
      "alphabetical": "Alfabetiskt (sorterat)",
      "bottom": "Sist i kön"
    },
    "notificationsHeader": "Aviseringar",
    "toastDuration": {
      "label": "Aviseringens varaktighet",
      "hint": "Hur länge aviseringar visas",
      "short": "Kort (2 s)",
      "normal": "Normal (4 s)",
      "long": "Lång (6 s)",
      "veryLong": "Mycket lång (8 s)"
    },
    "toastOpacity": {
      "label": "Aviseringens opacitet",
      "hint": "Aviseringarnas opacitet (0.5 = 50 %, 1.0 = 100 %)"
    },
    "renameHeader": "Namnbyte",
    "requireConfirm": "Kräv bekräftelse före namnbyte",
    "allowAlreadyRenamed": "Tillåt namnbyte av redan namnbytta filer",
    "prefixSource": {
      "label": "Prefixkälla",
      "hint": "Var datum/tid till filnamnsprefixet hämtas",
      "filename": "Från filnamn (mönstret YYMMDD_HHMMSS)",
      "exif": "Från EXIF-metadata",
      "filedate": "Från filens ändringsdatum",
      "none": "Inget prefix (endast namn)"
    },
    "nameSeparator": {
      "label": "Namnavgränsare",
      "commaUnderscore": ",_ (Anna,_Bert)",
      "underscore": "_ (Anna_Bert)",
      "dash": "- (Anna-Bert)",
      "och": "_och_ (Anna_och_Bert)"
    },
    "useFirstName": {
      "label": "Använd endast förnamn",
      "hint": "Använd endast förnamn i stället för fullständigt namn"
    },
    "removeDiacritics": {
      "label": "Ta bort diakritiska tecken",
      "hint": "Konvertera specialtecken (t.ex. é, ö) för säkrare filnamn"
    },
    "sidecarHeader": "Medföljande filer (sidecar)",
    "renameSidecars": {
      "label": "Byt namn på medföljande filer",
      "hint": "Byt även namn på associerade filer (XMP m.m.) vid namnbyte av bilder"
    },
    "sidecarExtensions": {
      "label": "Filändelser för medföljande filer",
      "hint": "Kommaseparerad lista (skiftlägesokänslig matchning)"
    },
    "trashHeader": "Papperskorg (Gallra)",
    "autoEmpty": {
      "label": "Töm papperskorgen automatiskt efter (dagar)",
      "hint": "Radera gallrade filer äldre än detta permanent. 0 = behåll för alltid."
    },
    "cullingPlayerHeader": "Gallra spelare",
    "autoAdvance": {
      "label": "Gå vidare automatiskt efter namnbyte",
      "hint": "Gå till nästa fil efter namnbyte i gallringen (infogat namnbyte eller borttagning av namn med ⌘↵)"
    }
  },
  "preprocessing": {
    "backgroundHeader": "Bakgrundsförbehandling",
    "intro": "Förbehandla köade filer i bakgrunden för att snabba upp inläsningen. Obs: Namnmatchning förbehandlas INTE – den kräver den aktuella databasen.",
    "enable": {
      "label": "Aktivera bakgrundsförbehandling",
      "hint": "Starta förbehandling när filer läggs till i kön"
    },
    "workers": {
      "label": "Parallella arbetare",
      "hint": "Antal filer att förbehandla samtidigt (1–8)"
    },
    "stepsHeader": "Förbehandlingssteg",
    "nefConversion": {
      "label": "NEF-konvertering",
      "hint": "Konvertera RAW-filer (NEF, CR2, ARW) till JPG"
    },
    "faceDetection": {
      "label": "Ansiktsdetektering",
      "hint": "Detektera ansikten och ramar"
    },
    "thumbnails": {
      "label": "Ansiktsminiatyrer",
      "hint": "Skapa miniatyrbilder för detekterade ansikten"
    },
    "cacheHeader": "Cacheinställningar",
    "maxSize": {
      "label": "Maximal cachestorlek (MB)",
      "hint": "Cachen använder LRU-utrensning när denna gräns överskrids"
    },
    "cache": {
      "statusLabel": "Cachestatus:",
      "entries": {
        "one": "{count} post",
        "other": "{count} poster"
      }
    },
    "rollingHeader": "Rullande fönster",
    "rollingIntro": "Styr hur många filer som förbehandlas i förväg. Förhindrar minnesproblem med stora köer.",
    "maxReady": {
      "label": "Max antal klara objekt",
      "hint": "Maximalt antal förbehandlade filer att hålla klara (5–50)"
    },
    "pauseBuffer": {
      "label": "Pausbuffert",
      "hint": "Pausa när så här många objekt är klara (bör vara märkbart mindre än Max antal klara objekt)"
    },
    "resumeAfter": {
      "label": "Återuppta efter",
      "hint": "Återuppta förbehandling efter så här många genomförda granskningar (1–15)"
    },
    "notificationsHeader": "Aviseringar",
    "statusIndicator": {
      "label": "Visa statusindikator",
      "hint": "Visa förbehandlingsstatus i filköns sidfot"
    },
    "toastOnPause": {
      "label": "Avisering vid paus",
      "hint": "Visa avisering när förbehandlingen pausas"
    },
    "toastOnResume": {
      "label": "Avisering vid återupptagning",
      "hint": "Visa avisering när förbehandlingen återupptas"
    }
  },
  "dashboard": {
    "sectionsHeader": "Statistiksektioner",
    "intro": "Välj vilka sektioner som ska visas i statistikpanelen.",
    "detectionStats": {
      "label": "Visa detekteringsstatistik",
      "hint": "Prestandatabell för detekteringsmotor"
    },
    "topFaces": {
      "label": "Visa rutnät med toppansikten",
      "hint": "Oftast detekterade personer"
    },
    "recentImages": {
      "label": "Visa senaste bilder",
      "hint": "Nyligen bearbetade bilder med detekterade namn"
    },
    "recentLogs": {
      "label": "Visa senaste loggrader",
      "hint": "Senaste loggposter"
    },
    "logLineCount": {
      "label": "Antal loggrader",
      "hint": "Hur många loggrader som ska visas (3–10)"
    },
    "autoRefreshHeader": "Automatisk uppdatering",
    "autoRefresh": {
      "label": "Uppdatera automatiskt vid start",
      "hint": "Uppdatera statistik automatiskt när panelen öppnas"
    },
    "refreshInterval": {
      "label": "Uppdateringsintervall",
      "hint": "Hur ofta statistiken uppdateras",
      "s2": "2 sekunder",
      "s5": "5 sekunder",
      "s10": "10 sekunder",
      "s30": "30 sekunder"
    }
  },
  "advanced": {
    "loggingHeader": "Loggning",
    "logLevel": {
      "label": "Loggnivå",
      "hint": "Lägsta allvarlighetsnivå för konsolutdata",
      "debug": "Debug (utförlig)",
      "info": "Info",
      "warn": "Varning",
      "error": "Fel"
    },
    "debugHeader": "Felsökningskategorier",
    "debugIntro": "Aktivera/inaktivera felsökningsutdata per kategori. Varningar och fel visas alltid."
  }
};
