/**
 * WorkflowBar — persistent pipeline navigation.
 *
 * A slim, always-visible row above the FlexLayout workspace (Lightroom
 * module-row style) that keeps the five pipeline steps (Import → Rename →
 * Review → Count → Culling) one click away, instead of buried in the View menu
 * or reachable only from the empty-workspace landing. UX grounding:
 *   - N1 (visibility of status): the active step is always shown/highlighted,
 *     and the chip dropdown surfaces all three working sets on screen.
 *   - N6 (recognition over recall): the workflow is on screen, not recalled.
 *   - N4 (consistency): same steps, order and labels as StartupLanding, from the
 *     shared workflowSteps catalog.
 *
 * Contents, left → right: numbered step buttons, the working-folder chip (a
 * button opening a per-working-set status dropdown), a "Fortsätt →" button when
 * the anchor has a known next step, and a "Verktyg ▾" menu of the non-pipeline
 * modules. Steps open via onOpenStep = openWorkflowStep, which MORPHS the live
 * workspace into the step (mounted modules keep their state; a dirty Review /
 * mid-processing File Queue is parked, not discarded); tools open via
 * onOpenTool = openModule as plain tabs.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useEmitEvent } from '../hooks/useModuleEvent.js';
import { useAnchoredDropdown } from '../hooks/useAnchoredDropdown.js';
import { getWorkingFolder, setWorkingFolder, subscribeWorkingFolder } from '../shared/workingFolder.js';
import { getScanScope, subscribeScanScope } from '../shared/scanScope.js';
import { getQueueStatus, subscribeQueueStatus } from '../shared/queueStatus.js';
import { prefersReducedMotion } from '../shared/motion.js';
import {
  WORKFLOW_STEPS,
  WORKFLOW_TOOLS,
  getContinuation,
  basename,
} from '../workspace/flexlayout/workflowSteps.js';
import { buildWorkingSetSummary } from './workflowBar/workingSetSummary.js';
import { useWorkflowBarAutoHide } from './workflowBar/useAutoHide.js';
import { Icon } from './Icon.jsx';
import { Button } from './shared';
import { t } from '../../i18n/index.js';
import './WorkflowBar.css';

/**
 * When `autoHide` is on the row slides out of view after a few seconds idle and
 * returns on a step change or when the pointer/keyboard reaches the top edge; a
 * thin hover-zone at the very top catches the reveal while it is hidden. With
 * `autoHide` off it is a normal always-visible flex child (today's behaviour).
 *
 * @param {object} props
 * @param {string|null} props.activeStep - Step id currently active, highlighted in the bar.
 * @param {(moduleId: string) => void} props.onOpenStep - Open a pipeline step (existing landing paths).
 * @param {(moduleId: string) => void} props.onOpenTool - Open a non-pipeline tool as a tab.
 * @param {boolean} [props.autoHide=false] - Slide the row away when idle (opt-out preference).
 */
export function WorkflowBar({ activeStep, onOpenStep, onOpenTool, autoHide = false }) {
  const emit = useEmitEvent();

  // The three working sets drive the chip + its dropdown. All three are shared
  // stores with display-only subscriptions, so the bar stays live without
  // remounting (and without touching the modules' adopt-on-mount behavior).
  const [anchor, setAnchor] = useState(() => getWorkingFolder());
  const [scan, setScan] = useState(() => getScanScope());
  const [queue, setQueue] = useState(() => getQueueStatus());
  useEffect(() => subscribeWorkingFolder(setAnchor), []);
  useEffect(() => subscribeScanScope(setScan), []);
  useEffect(() => subscribeQueueStatus(setQueue), []);

  const cont = useMemo(() => getContinuation(anchor), [anchor]);

  const roots = Array.isArray(anchor?.roots) ? anchor.roots : [];
  const hasFolder = roots.length > 0;
  const folderName = hasFolder ? basename(roots[0]) : null;
  const chipTitle = hasFolder ? roots.join('\n') : undefined;

  const summary = useMemo(
    () => buildWorkingSetSummary(t, { queue, scan, anchor, steps: WORKFLOW_STEPS }),
    [queue, scan, anchor],
  );

  // Two anchored popovers in this bar: the chip's working-set dropdown and the
  // Verktyg menu. Both share the outside-click/Escape dismiss via the hook.
  const chip = useAnchoredDropdown();
  const tools = useAnchoredDropdown();

  // Autohide: the pointer resting on the bar, keyboard focus inside it, or an
  // open dropdown all freeze the hide timer so the row can't slide away under an
  // open menu or mid tab-navigation (a11y).
  const [hovering, setHovering] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const paused = hovering || focusWithin || chip.open || tools.open;
  const { revealed, reveal } = useWorkflowBarAutoHide({
    enabled: autoHide,
    paused,
    activeStep,
  });
  // Reduced motion: the global media block already neutralises the transition;
  // this switches the hidden mechanism to a plain fade (no slide, no phosphor).
  const reducedMotion = useMemo(() => prefersReducedMotion(), []);
  const handleBlur = useCallback((e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setFocusWithin(false);
  }, []);

  const hidden = autoHide && !revealed;
  const barClass = [
    'workflow-bar',
    autoHide ? 'autohide' : '',
    hidden ? 'hidden' : '',
    reducedMotion ? 'reduced-motion' : '',
  ].filter(Boolean).join(' ');

  const openTool = useCallback((moduleId) => {
    tools.close();
    onOpenTool(moduleId);
  }, [tools, onOpenTool]);

  // "Byt mapp…" — pick a folder and set ONLY the anchor (no step, so it offers no
  // continuation until the user explicitly hands it off). Never auto-loads.
  const changeFolder = useCallback(async () => {
    chip.close();
    const picked = await window.ansiktenAPI?.invoke('open-folder-paths');
    if (Array.isArray(picked) && picked.length > 0) {
      setWorkingFolder({ roots: picked });
    }
  }, [chip]);

  // Opt-in hand-offs from the anchor into a downstream step. Both pass the
  // anchor's roots; the target adopts them and never auto-runs on its own.
  const useInReview = useCallback(() => {
    chip.close();
    if (hasFolder) emit('open-review-queue', { roots });
  }, [chip, emit, hasFolder, roots]);

  const useInCount = useCallback(() => {
    chip.close();
    if (hasFolder) emit('open-count', { roots });
  }, [chip, emit, hasFolder, roots]);

  return (
    <>
      {autoHide && (
        // Thin catch-strip pinned to the top edge; hovering it slides the bar
        // back down. Only present while hidden so it never eats clicks on a
        // revealed bar. Pointer-driven convenience — never the only way in
        // (Cmd+1..5, step changes and focus all reveal the row too).
        <div
          className={`workflow-bar-hover-zone${hidden ? '' : ' inert'}`}
          aria-hidden="true"
          onMouseEnter={reveal}
        />
      )}
      <div
        className={barClass}
        role="toolbar"
        aria-label={t('workflowBar.label')}
        aria-hidden={hidden ? 'true' : undefined}
        onMouseEnter={autoHide ? () => setHovering(true) : undefined}
        onMouseLeave={autoHide ? () => setHovering(false) : undefined}
        onFocus={autoHide ? () => setFocusWithin(true) : undefined}
        onBlur={autoHide ? handleBlur : undefined}
      >
      <div className="workflow-bar-steps">
        {WORKFLOW_STEPS.map((step, i) => {
          const active = activeStep === step.step;
          return (
            <button
              key={step.moduleId}
              type="button"
              className={`workflow-bar-step${active ? ' active' : ''}`}
              aria-pressed={active}
              onClick={() => onOpenStep(step.moduleId)}
            >
              <span className="workflow-bar-step-ordinal" aria-hidden="true">{i + 1}</span>
              <Icon name={step.icon} size={15} />
              <span className="workflow-bar-step-label">{t(`modules.${step.moduleId}`)}</span>
            </button>
          );
        })}
      </div>

      <div className="workflow-bar-spacer" />

      <div className="workflow-bar-chip-wrap" ref={chip.ref}>
        <button
          type="button"
          className={`workflow-bar-chip${hasFolder ? '' : ' empty'}${chip.open ? ' active' : ''}`}
          title={chipTitle}
          aria-haspopup="true"
          aria-expanded={chip.open}
          onClick={chip.toggle}
        >
          <Icon name="folder" size={14} />
          <span className="workflow-bar-chip-name">
            {hasFolder ? folderName : t('workflowBar.noFolder')}
          </span>
          <Icon name="chevron-down" size={13} />
        </button>
        {chip.open && (
          // A status popover (headings, status lines, action buttons), not a menu
          // of menuitems — role=group, not role=menu (which would mislabel the
          // mixed content to AT). The Verktyg menu below IS a real menu.
          <div className="workflow-bar-chip-menu" role="group" aria-label={t('workflowBar.chipMenuLabel')}>
            <div className="workflow-bar-chip-section-title">{t('workflowBar.summaryTitle')}</div>
            <ul className="workflow-bar-chip-sets">
              {summary.map((line) => (
                <li key={line.key} className={`workflow-bar-chip-set${line.empty ? ' empty' : ''}`}>
                  <span className="workflow-bar-chip-set-label">{line.label}</span>
                  <span className="workflow-bar-chip-set-value">{line.value}</span>
                </li>
              ))}
            </ul>
            <div className="workflow-bar-chip-section-title">{t('workflowBar.actionsLabel')}</div>
            <div className="workflow-bar-chip-actions">
              <Button variant="ghost" size="sm" onClick={changeFolder} title={t('workflowBar.changeFolderTitle')}>
                {t('workflowBar.changeFolder')}
              </Button>
              <Button variant="ghost" size="sm" onClick={useInReview} disabled={!hasFolder} title={t('workflowBar.useInReviewTitle')}>
                {t('workflowBar.useInReview')}
              </Button>
              <Button variant="ghost" size="sm" onClick={useInCount} disabled={!hasFolder} title={t('workflowBar.useInCountTitle')}>
                {t('workflowBar.useInCount')}
              </Button>
            </div>
          </div>
        )}
      </div>

      {cont && (
        <button
          type="button"
          className="workflow-bar-continue"
          onClick={() => emit(cont.event, { roots: cont.roots })}
        >
          <span>{t(cont.labelKey)}</span>
          <Icon name="skip-next" size={15} />
        </button>
      )}

      <div className="workflow-bar-tools" ref={tools.ref}>
        <button
          type="button"
          className={`workflow-bar-tools-toggle${tools.open ? ' active' : ''}`}
          aria-haspopup="menu"
          aria-expanded={tools.open}
          onClick={tools.toggle}
        >
          <span>{t('workflowBar.tools')}</span>
          <Icon name="chevron-down" size={14} />
        </button>
        {tools.open && (
          <ul className="workflow-bar-tools-menu" role="menu">
            {WORKFLOW_TOOLS.map((tool) => (
              <li key={tool.moduleId} role="none">
                <button
                  type="button"
                  role="menuitem"
                  className="workflow-bar-tools-item"
                  onClick={() => openTool(tool.moduleId)}
                >
                  <Icon name={tool.icon} size={15} />
                  <span>{t(`modules.${tool.moduleId}`)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      </div>
    </>
  );
}

export default WorkflowBar;
