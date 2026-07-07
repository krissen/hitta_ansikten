// Swedish catalog namespace: themeEditor
module.exports = {
  "sidebar": {
    "categories": "Kategorier",
    "presets": "Förval"
  },
  "categories": {
    "themeMode": "Temaläge",
    "tabAppearance": "Flikutseende",
    "backgrounds": "Bakgrunder",
    "textColors": "Textfärger",
    "borders": "Ramar",
    "accentColors": "Accentfärger",
    "semanticColors": "Semantiska färger",
    "overlayColors": "Överläggsfärger",
    "spacing": "Mellanrum",
    "borderRadius": "Hörnradie",
    "opacity": "Opacitet"
  },
  "sizes": {
    "extraSmall": "Extra litet",
    "small": "Litet",
    "medium": "Mellan",
    "large": "Stort",
    "extraLarge": "Extra stort",
    "xxLarge": "2× stort"
  },
  "vars": {
    "tabs": {
      "height": "Flikhöjd",
      "fontSize": "Teckenstorlek",
      "paddingLeft": "Vänsterutfyllnad",
      "paddingRight": "Högerutfyllnad",
      "minGap": "Minsta mellanrum",
      "minWidth": "Minsta bredd (0=auto)"
    },
    "bg": {
      "primary": "Primär bakgrund",
      "secondary": "Sekundär bakgrund",
      "tertiary": "Tertiär bakgrund",
      "elevated": "Upphöjd (kort)",
      "hover": "Vid hovring",
      "active": "Aktivt läge"
    },
    "text": {
      "primary": "Primär text",
      "secondary": "Sekundär text",
      "tertiary": "Tertiär text",
      "inverse": "Inverterad text",
      "onAccent": "Text på accent"
    },
    "border": {
      "subtle": "Diskret ram",
      "medium": "Medelkraftig ram",
      "strong": "Kraftig ram"
    },
    "accent": {
      "primary": "Primär accent",
      "primaryHover": "Primär hovring",
      "secondary": "Sekundär accent",
      "secondaryHover": "Sekundär hovring"
    },
    "semantic": {
      "success": "Framgång",
      "successBg": "Framgångsbakgrund",
      "warning": "Varning",
      "warningBg": "Varningsbakgrund",
      "error": "Fel",
      "errorBg": "Felbakgrund",
      "info": "Info",
      "infoBg": "Infobakgrund",
      "successText": "Framgång (text)",
      "warningText": "Varning (text)",
      "errorText": "Fel (text)"
    },
    "overlay": {
      "bg": "Överläggsbakgrund",
      "text": "Överläggstext"
    },
    "opacity": {
      "toast": "Aviseringsopacitet",
      "overlay": "Överläggsopacitet"
    }
  },
  "themeModeOptions": {
    "light": "Ljust",
    "dark": "Mörkt",
    "system": "Följ system"
  },
  "labels": {
    "currentTheme": "Aktuellt tema:",
    "presetBindings": "Förvalsbindningar",
    "lightModePreset": "Förval för ljust läge:",
    "darkModePreset": "Förval för mörkt läge:"
  },
  "hints": {
    "followingSystem": "Följer systemet (för närvarande {theme})",
    "usingTheme": "Använder {theme}-tema",
    "presetBindings": "Välj vilket förval som ska användas för varje temaläge"
  },
  "presetNamePlaceholder": "Förvalsnamn…",
  "deleteTitle": "Ta bort",
  "dialogs": {
    "deletePreset": {
      "title": "Ta bort förval",
      "message": "Ta bort förvalet ”{name}”? Det går inte att ångra.",
      "confirm": "Ta bort"
    },
    "reset": {
      "title": "Återställ tema",
      "message": "Återställ alla temaändringar till standardvärdena? Dina osparade justeringar av färger och storlekar tas bort. Sparade förval påverkas inte.",
      "confirm": "Återställ"
    }
  },
  "toasts": {
    "importError": "Kunde inte importera förval. Kontrollera att filen är en giltig temaexport (JSON)."
  },
  "buttons": {
    "export": "Exportera",
    "import": "Importera"
  }
};
