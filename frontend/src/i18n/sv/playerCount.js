// Swedish catalog namespace: playerCount
module.exports = {
  "title": "Räkna spelare",
  // "Per match" kept as-is — established sports term, reads natively in Swedish.
  "perMatch": "Per match",
  "refreshing": "uppdaterar…",
  // Toolbar button: hand the current scope over to Gallra spelare (culling).
  // Uses the shared "Nästa steg: <verb> →" hand-off formulation.
  "gallra": "Nästa steg: Gallra →",
  "gallraTitle": "Öppna Gallra spelare med samma urval",

  // Body states
  "errorPrefix": "Fel:",
  "counting": "Räknar…",
  "emptyPrompt": {
    "before": "Välj en mapp eller ange ett wildcard och tryck ",
    "action": "Räkna",
    "after": "."
  },
  "noMatches": "Inga matchande bilder hittades.",

  // Result summary. `images`/`players` are bare labels — the count is rendered
  // bold next to them in JSX; Swedish nouns don't inflect for plural here.
  "summary": {
    "images": "bilder",
    "players": "spelare",
    "baseline": "Baslinje ({method})",
    "files": "{count} filer",
    "duration": "({minutes} min)"
  },

  // Counting options
  "options": {
    "matchGap": "Matchgap (min)",
    "matchGapTitle": "Minsta lucka mellan matcher (delar upp bilderna i matcher)",
    "baseline": "Baslinje",
    "baselineTitle": "Referens för över-/underrepresentation",
    "baselineMedian": "median",
    "baselineMean": "medel",
    "minImages": "Min bilder",
    "minImagesTitle": "Minsta antal bilder för att räknas som spelare",
    "excludedToggle": "Uteslutna"
  },

  // Exclusion editor
  "exclusions": {
    "spelare": "Tillfälligt spelare (denna session)",
    "tranare": "Tränare",
    "publik": "Publik",
    "alwaysHeading": "Alltid uteslutna (sparas)",
    "alwaysHeadingTitle": "Alltid uteslutna oavsett tröskel — gäller efter Spara som standard",
    "grupp": "Gruppbilder",
    "alwaysPublik": "Publik (alltid)",
    "envNote": "{keys} är satt i miljön och överstyr config — ”Spara som standard” kanske inte får effekt.",
    "saveDefaults": "Spara som standard",
    "saving": "Sparar…",
    "saveDefaultsTitle": "Spara listorna till config (gäller framtida räkningar och CLI)",
    "reset": "Återställ",
    "resetTitle": "Återställ till sparade standardlistor",
    "unsaved": "osparade ändringar",
    "empty": "inga",
    "add": "Lägg till {title}",
    "addPlaceholder": "Lägg till {title}…",
    "remove": "Ta bort {name}"
  },

  // Player table
  "table": {
    "name": "Namn",
    "count": "Antal",
    "pct": "%",
    "deltaPct": "Δ%",
    "deltaTitle": "Avvikelse från baslinjen — medianen eller medelvärdet av bildantalet för de inkluderade spelarna. Positivt = fler bilder än baslinjen, negativt = färre.",
    "deltaN": "ΔN",
    "distribution": "Fördelning",
    "timeline": "Tidslinje",
    "rowTitle": "Gallra {name}",
    "baselineBarTitle": "Baslinje {baseline}",
    "sparkTitle": "{count} bilder över tid"
  },

  // Excluded sections
  "excludedLabels": {
    "tranare": "Tränare",
    "grupp": "Gruppbilder",
    "publik": "Publik",
    "below_threshold": "Under tröskeln"
  },

  // Right-click menu on a name (session moves + permanent publik)
  "contextMenu": {
    "toPlayerSession": "Gör till spelare (denna session)",
    "toPublikSession": "Flytta till publik (denna session)",
    "toTranareSession": "Flytta till tränare (denna session)",
    "toGruppSession": "Flytta till gruppbilder (denna session)",
    "publikPermanent": "Gör publik permanent"
  },

  // Per-match sections
  "match": {
    "summary": "Match {index} — {start} → {end} ({minutes} min, {images} bilder)",
    "info": "(av {total}, exkl. {excluded})",
    "noPlayers": "Inga spelare över tröskeln."
  }
};
