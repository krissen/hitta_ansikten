// Swedish catalog namespace: shortcuts (keyboard-shortcuts help overlay)
//
// Section titles that equal a module name are NOT duplicated here — the JSX
// reuses `modules.*` (e.g. Bildvisare, Granska ansikten, Filkö, Gallra spelare).
// Only sections without a module equivalent live under `sections.*`.
module.exports = {
  header: "Tangentbordsgenvägar",
  footer: {
    before: "Tryck på ",
    or: " eller ",
    after: " för att stänga"
  },
  sections: {
    navigation: "Navigering",
    layout: "Layout",
    general: "Allmänt"
  },
  desc: {
    nav: {
      moveFocus: "Flytta fokus mellan paneler",
      prevNextItem: "Föregående/nästa objekt",
      completeName: "Komplettera namn (i inmatningsfält)"
    },
    layout: {
      switchTemplate: "Byt layoutmall",
      switchStep: "Byt arbetsflödessteg (Importera→Gallra)",
      addColumn: "Lägg till kolumn",
      removeColumn: "Ta bort kolumn",
      addRow: "Lägg till rad",
      removeRow: "Ta bort rad",
      groupAsTab: "Gruppera panel som flik i riktningen",
      moveToNewTabset: "Flytta panel till ny kolumn/rad"
    },
    viewer: {
      zoom: "Zooma in/ut (håll för kontinuerlig)",
      reset: "Återställ till 1:1",
      autoFit: "Anpassa till fönster",
      toggleBoxes: "Visa/dölj markeringsramar",
      boxesHide: "Dölj markeringsramar",
      toggleSingleAll: "Växla enstaka/alla ramar",
      boxesSingle: "Visa bara den markerade ramen",
      autoCenter: "Växla autocentrering på ansikte",
      autoCenterOff: "Stäng av autocentrering på ansikte",
      toggleFileInfo: "Visa/dölj filinformation",
      fileInfoHide: "Dölj filinformation"
    },
    review: {
      acceptMatch: "Acceptera föreslagen matchning",
      ignoreFace: "Ignorera ansikte",
      rename: "Byt namn / ange namn",
      selectAlternative: "Välj matchningsalternativ",
      prevNextFace: "Föregående/nästa ansikte",
      skipFile: "Hoppa till nästa fil",
      manualSuffix: "Lägg till filnamnstillägg (ej namn)",
      acceptAll: "Acceptera alla förslag",
      undo: "Ångra senaste ansiktsåtgärd",
      deleteToTrash: "Flytta aktuell fil till papperskorgen",
      undoDelete: "Ångra radering",
      cancel: "Avbryt ansiktssökning / kasta ändringar",
      addManualFace: "Lägg till ansikte manuellt"
    },
    queue: {
      openFiles: "Öppna filer",
      navigate: "Navigera i kön",
      loadFile: "Läs in markerad fil",
      remove: "Ta bort från kön",
      selectAll: "Markera alla filer"
    },
    culling: {
      nextImage: "Nästa bild",
      prevImage: "Föregående bild",
      page: "Sidhoppa (10 steg)",
      zoom: "Zooma in/ut (enkelbild)",
      resetZoom: "Återställ till 1:1 (enkelbild)",
      autoFit: "Anpassa till fönster (enkelbild)",
      cull: "Gallra till papperskorgen",
      rename: "Byt namn på fil (dubbelklick)",
      openLoupe: "Öppna markerad bild i lupp",
      closeMenu: "Stäng snabbmenyn",
      discardPendingNames: "Kasta pågående namnborttagningar",
      exitLoupe: "Lämna luppen och återgå till rutnätet",
      applyRemovals: "Tillämpa namnborttagningar från förhandsgranskningen",
      undo: "Ångra senaste gallring",
      openLightroom: "Öppna original-NEF i extern editor"
    },
    general: {
      showHelp: "Visa den här hjälpen",
      reload: "Ladda om fönstret",
      hardReload: "Ladda om fönstret (tvingad omladdning)",
      preferences: "Inställningar"
    }
  }
};
