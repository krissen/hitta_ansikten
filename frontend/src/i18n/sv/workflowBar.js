// Swedish catalog namespace: workflowBar
module.exports = {
  label: 'Arbetsflöde',
  tools: 'Verktyg',
  noFolder: 'Ingen arbetsmapp',
  // {path} full folder path, {step} the step that set the anchor.
  folderTooltipSetBy: '{path}\nSatt av: {step}',
  // Shown when switching workflow step would discard unsaved Review edits.
  unsavedStepChange: 'Du har osparade ändringar i Granska. Byta steg ändå?',
  switchAnyway: 'Byt steg',

  // Chip dropdown — per-working-set status overview + opt-in actions.
  chipMenuLabel: 'Arbetsmängder',
  summaryTitle: 'Arbetsmängder',
  unknownFolder: 'okänd mapp',
  // Queue set.
  queueLabel: 'Kö',
  queueValue: '{count} filer ({done} klara) — {folder}',
  queueEmpty: 'Ingen kö',
  // Scan set.
  scanLabel: 'Skanning',
  scanValue: '{folder}',
  scanValueFlags: '{folder} ({flags})',
  scanEmpty: 'Ingen skanning',
  scanRecursive: 'rekursiv',
  scanGlobs: 'globfilter',
  scanDates: 'datumspann',
  // Anchor set.
  anchorLabel: 'Ankare',
  anchorValue: '{folder}',
  anchorValueSetBy: '{folder} (satt av {step})',
  anchorEmpty: 'Inget ankare',
  // Actions (opt-in — never auto-load).
  actionsLabel: 'Åtgärder',
  changeFolder: 'Byt mapp…',
  changeFolderTitle: 'Välj en mapp och sätt den som arbetsflödets ankare',
  useInReview: 'Använd i Granska',
  useInReviewTitle: 'Öppna Granska ansikten med ankarets mapp',
  useInCount: 'Använd i Räkna/Gallra',
  useInCountTitle: 'Öppna Räkna spelare med ankarets mapp',
};
