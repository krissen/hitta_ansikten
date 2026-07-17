/**
 * StartupLanding - Empty-workspace landing page.
 *
 * Shown by FlexLayoutWorkspace when the app starts with no queue/files. Presents
 * the workflow steps in order as buttons that open the matching module. The
 * Import step is enabled only while a camera card volume is mounted; the others
 * are always enabled (each module handles its own file selection / empty state).
 * The view is dismissed by the workspace once a module opens or an image loads.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useBackend } from '../context/BackendContext.jsx';
import { useEmitEvent } from '../hooks/useModuleEvent.js';
import { getWorkingFolder, subscribeWorkingFolder } from '../shared/workingFolder.js';
import {
  WORKFLOW_STEPS,
  WORKFLOW_TOOLS,
  getContinuation,
} from '../workspace/flexlayout/workflowSteps.js';
import { Icon } from './Icon.jsx';
import { Button } from './shared';
import { t } from '../../i18n/index.js';
import './StartupLanding.css';

// Poll interval for card detection so Import lights up when a card is inserted.
const VOLUME_POLL_MS = 4000;

export function StartupLanding({ onOpenModule }) {
  const { api } = useBackend();
  const emit = useEmitEvent();
  const [cardPresent, setCardPresent] = useState(false);

  // The working-folder anchor (set by an earlier import/rename). Subscribe so the
  // continue row appears/updates/disappears live without remounting the landing.
  const [anchor, setAnchor] = useState(() => getWorkingFolder());
  useEffect(() => subscribeWorkingFolder(setAnchor), []);

  const cont = useMemo(() => getContinuation(anchor), [anchor]);

  const checkVolumes = useCallback(async () => {
    try {
      const data = await api.get('/api/v1/import/volumes');
      setCardPresent((data.volumes || []).length > 0);
    } catch {
      // Backend may not be ready yet; treat as no card and retry on next poll.
      setCardPresent(false);
    }
  }, [api]);

  useEffect(() => {
    checkVolumes();
    const id = setInterval(checkVolumes, VOLUME_POLL_MS);
    return () => clearInterval(id);
  }, [checkVolumes]);

  // Workflow steps are the page's main actions (primary, numbered — they form
  // a sequence); tools are supporting views (secondary, unnumbered).
  const renderStep = (step, ordinal) => {
    const disabled = step.requiresCard && !cardPresent;
    return (
      <Button
        key={step.moduleId}
        variant={ordinal != null ? 'primary' : 'secondary'}
        className="startup-landing-step"
        disabled={disabled}
        title={disabled ? t('startupLanding.importCardHint') : undefined}
        onClick={() => onOpenModule(step.moduleId)}
      >
        {ordinal != null && <span className="step-ordinal" aria-hidden="true">{ordinal}.</span>}
        <Icon name={step.icon} size={16} />
        <span>{t(`modules.${step.moduleId}`)}</span>
      </Button>
    );
  };

  return (
    <div className="startup-landing" role="region" aria-label={t('startupLanding.title')}>
      <div className="startup-landing-card">
        <h1 className="startup-landing-title">{t('startupLanding.title')}</h1>
        <p className="startup-landing-subtitle">{t('startupLanding.subtitle')}</p>

        {cont && (
          <div className="startup-landing-continue">
            <span className="startup-landing-continue-folder">
              {t('startupLanding.currentFolder', { name: cont.name })}
            </span>
            <Button
              variant="primary"
              className="startup-landing-continue-btn"
              onClick={() => emit(cont.event, { roots: cont.roots })}
            >
              <Icon name="skip-next" size={16} />
              <span>{t(cont.labelKey)}</span>
            </Button>
          </div>
        )}

        <div className="startup-landing-divider">{t('startupLanding.workflow')}</div>
        <div className="startup-landing-steps">{WORKFLOW_STEPS.map((s, i) => renderStep(s, i + 1))}</div>

        <div className="startup-landing-divider">{t('startupLanding.tools')}</div>
        <div className="startup-landing-steps">{WORKFLOW_TOOLS.map((s) => renderStep(s))}</div>
      </div>
    </div>
  );
}
