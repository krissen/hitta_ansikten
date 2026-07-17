/**
 * workingSetSummary — pure derivation of the three working-set status lines shown
 * in the WorkflowBar chip dropdown. The pipeline has three independent working
 * sets that tend to point at the same event folder but are deliberately NOT
 * merged: the file queue (Review), the scan scope (Räkna/Gallra), and the
 * working-folder anchor (a pointer). "Which file queue belongs to which flow?"
 * is answered on screen (Nielsen N1/N6) by rendering all three at once.
 *
 * Kept pure (state in → localized strings out) so the status-string logic is unit
 * testable without mounting the bar. The `t` translator is injected so tests can
 * assert against the real catalog.
 */

import { basename } from '../../workspace/flexlayout/workflowSteps.js';

/**
 * Human label for the step id that set the anchor, via the injected translator.
 * Returns null when unknown, so callers can fall back to the plain value line.
 */
function stepName(t, stepId, steps) {
  const entry = (steps || []).find((s) => s.step === stepId);
  return entry ? t(`modules.${entry.moduleId}`) : null;
}

/**
 * Build the three working-set status lines.
 *
 * @param {(key: string, vars?: object) => string} t - translator
 * @param {object} sets
 * @param {{ folder: string|null, count: number, done: number } | null} sets.queue
 * @param {{ roots?: string[], globs?: string[], recursive?: boolean, date_from?: string, date_to?: string } | null} sets.scan
 * @param {{ roots?: string[], step?: string } | null} sets.anchor
 * @param {Array<{ step: string, moduleId: string }>} [sets.steps] - WORKFLOW_STEPS, for the anchor's "set by" label
 * @returns {Array<{ key: 'queue'|'scan'|'anchor', label: string, value: string, empty: boolean }>}
 */
export function buildWorkingSetSummary(t, { queue, scan, anchor, steps } = {}) {
  // Queue: "N filer (M klara) — <mapp>" or "Ingen kö".
  const hasQueue = !!queue && queue.count > 0;
  const queueLine = {
    key: 'queue',
    label: t('workflowBar.queueLabel'),
    empty: !hasQueue,
    value: hasQueue
      ? t('workflowBar.queueValue', {
          count: queue.count,
          done: queue.done || 0,
          folder: queue.folder ? basename(queue.folder) : t('workflowBar.unknownFolder'),
        })
      : t('workflowBar.queueEmpty'),
  };

  // Scan: "<mapp> (rekursiv, globfilter, datum)" or "Ingen skanning".
  const scanRoots = Array.isArray(scan?.roots) ? scan.roots : [];
  const scanGlobs = Array.isArray(scan?.globs) ? scan.globs : [];
  const hasScan = scanRoots.length > 0 || scanGlobs.length > 0;
  let scanValue = t('workflowBar.scanEmpty');
  if (hasScan) {
    const where = scanRoots.length > 0 ? basename(scanRoots[0]) : scanGlobs[0];
    const flags = [];
    if (scan.recursive) flags.push(t('workflowBar.scanRecursive'));
    if (scanGlobs.length > 0 && scanRoots.length > 0) flags.push(t('workflowBar.scanGlobs'));
    if (scan.date_from || scan.date_to) flags.push(t('workflowBar.scanDates'));
    scanValue = flags.length > 0
      ? t('workflowBar.scanValueFlags', { folder: where, flags: flags.join(', ') })
      : t('workflowBar.scanValue', { folder: where });
  }
  const scanLine = { key: 'scan', label: t('workflowBar.scanLabel'), empty: !hasScan, value: scanValue };

  // Anchor: "<mapp> (satt av <steg>)" or "Inget ankare".
  const anchorRoots = Array.isArray(anchor?.roots) ? anchor.roots : [];
  const hasAnchor = anchorRoots.length > 0;
  let anchorValue = t('workflowBar.anchorEmpty');
  if (hasAnchor) {
    const folder = basename(anchorRoots[0]);
    const setBy = stepName(t, anchor.step, steps);
    anchorValue = setBy
      ? t('workflowBar.anchorValueSetBy', { folder, step: setBy })
      : t('workflowBar.anchorValue', { folder });
  }
  const anchorLine = { key: 'anchor', label: t('workflowBar.anchorLabel'), empty: !hasAnchor, value: anchorValue };

  return [queueLine, scanLine, anchorLine];
}
