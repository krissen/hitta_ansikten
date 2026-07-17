/**
 * WorkflowBar — persistent pipeline navigation.
 *
 * A slim, always-visible row above the FlexLayout workspace (Lightroom
 * module-row style) that keeps the five pipeline steps (Import → Rename →
 * Review → Count → Culling) one click away, instead of buried in the View menu
 * or reachable only from the empty-workspace landing. UX grounding:
 *   - N1 (visibility of status): the active step is always shown/highlighted.
 *   - N6 (recognition over recall): the workflow is on screen, not recalled.
 *   - N4 (consistency): same steps, order and labels as StartupLanding, from the
 *     shared workflowSteps catalog.
 *
 * Contents, left → right: numbered step buttons, the working-folder chip, a
 * "Fortsätt →" button when the anchor has a known next step, and a "Verktyg ▾"
 * menu of the non-pipeline modules. Steps open via onOpenStep = openWorkflowStep,
 * which MORPHS the live workspace into the step (mounted modules keep their
 * state; a dirty Review / mid-processing File Queue is parked, not discarded);
 * tools open via onOpenTool = openModule as plain tabs.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEmitEvent } from '../hooks/useModuleEvent.js';
import { getWorkingFolder, subscribeWorkingFolder } from '../shared/workingFolder.js';
import {
  WORKFLOW_STEPS,
  WORKFLOW_TOOLS,
  getContinuation,
  basename,
} from '../workspace/flexlayout/workflowSteps.js';
import { Icon } from './Icon.jsx';
import { t } from '../../i18n/index.js';
import './WorkflowBar.css';

// Human label for the step that last set the anchor, or null if unknown. Used
// only in the chip tooltip.
function stepLabel(stepId) {
  const entry = WORKFLOW_STEPS.find((s) => s.step === stepId);
  return entry ? t(`modules.${entry.moduleId}`) : null;
}

/**
 * @param {object} props
 * @param {string|null} props.activeStep - Step id currently active, highlighted in the bar.
 * @param {(moduleId: string) => void} props.onOpenStep - Open a pipeline step (existing landing paths).
 * @param {(moduleId: string) => void} props.onOpenTool - Open a non-pipeline tool as a tab.
 */
export function WorkflowBar({ activeStep, onOpenStep, onOpenTool }) {
  const emit = useEmitEvent();

  // The working-folder anchor drives both the chip and the Continue button;
  // subscribe so both update live without remounting the bar.
  const [anchor, setAnchor] = useState(() => getWorkingFolder());
  useEffect(() => subscribeWorkingFolder(setAnchor), []);

  const cont = useMemo(() => getContinuation(anchor), [anchor]);

  const roots = Array.isArray(anchor?.roots) ? anchor.roots : [];
  const hasFolder = roots.length > 0;
  const folderName = hasFolder ? basename(roots[0]) : null;
  const setByLabel = hasFolder ? stepLabel(anchor?.step) : null;
  const chipTitle = hasFolder
    ? (setByLabel
        ? t('workflowBar.folderTooltipSetBy', { path: roots.join('\n'), step: setByLabel })
        : roots.join('\n'))
    : undefined;

  // "Verktyg ▾" menu open state, closed on outside click / Escape.
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsRef = useRef(null);
  useEffect(() => {
    if (!toolsOpen) return undefined;
    const onDocDown = (e) => {
      if (toolsRef.current && !toolsRef.current.contains(e.target)) setToolsOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setToolsOpen(false); };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [toolsOpen]);

  const openTool = useCallback((moduleId) => {
    setToolsOpen(false);
    onOpenTool(moduleId);
  }, [onOpenTool]);

  return (
    <div className="workflow-bar" role="toolbar" aria-label={t('workflowBar.label')}>
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

      <div
        className={`workflow-bar-chip${hasFolder ? '' : ' empty'}`}
        title={chipTitle}
      >
        <Icon name="folder" size={14} />
        <span className="workflow-bar-chip-name">
          {hasFolder ? folderName : t('workflowBar.noFolder')}
        </span>
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

      <div className="workflow-bar-tools" ref={toolsRef}>
        <button
          type="button"
          className={`workflow-bar-tools-toggle${toolsOpen ? ' active' : ''}`}
          aria-haspopup="menu"
          aria-expanded={toolsOpen}
          onClick={() => setToolsOpen((v) => !v)}
        >
          <span>{t('workflowBar.tools')}</span>
          <Icon name="chevron-down" size={14} />
        </button>
        {toolsOpen && (
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
  );
}

export default WorkflowBar;
