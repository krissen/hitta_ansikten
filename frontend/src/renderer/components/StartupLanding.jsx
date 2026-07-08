/**
 * StartupLanding - Empty-workspace landing page.
 *
 * Shown by FlexLayoutWorkspace when the app starts with no queue/files. Presents
 * the workflow steps in order as buttons that open the matching module. The
 * Import step is enabled only while a camera card volume is mounted; the others
 * are always enabled (each module handles its own file selection / empty state).
 * The view is dismissed by the workspace once a module opens or an image loads.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useBackend } from '../context/BackendContext.jsx';
import { Icon } from './Icon.jsx';
import { Button } from './shared';
import { t } from '../../i18n/index.js';
import './StartupLanding.css';

// Poll interval for card detection so Import lights up when a card is inserted.
const VOLUME_POLL_MS = 4000;

// Workflow steps in order. `requiresCard` gates Import on a mounted card volume;
// the rest are always enabled. `moduleId` strings match MODULE_COMPONENTS; the
// label is the module's catalog title (t('modules.<id>')).
const STEPS = [
  {
    moduleId: 'import',
    icon: 'folder-plus',
    requiresCard: true,
  },
  { moduleId: 'rename-nef', icon: 'file' },
  { moduleId: 'review-module', icon: 'user' },
  { moduleId: 'player-count', icon: 'layers' },
  { moduleId: 'culling', icon: 'check-circle' },
];

// The remaining views/tools — always available, opened directly (fill the
// workspace). Reachable so you can jump straight to e.g. Databashantering.
const TOOLS = [
  { moduleId: 'database-management', icon: 'sort' },
  { moduleId: 'refine-faces', icon: 'bolt' },
  { moduleId: 'file-queue', icon: 'folder' },
  { moduleId: 'statistics-dashboard', icon: 'layers' },
  { moduleId: 'log-viewer', icon: 'file' },
  { moduleId: 'preferences', icon: 'settings' },
  { moduleId: 'theme-editor', icon: 'circle' },
];

export function StartupLanding({ onOpenModule }) {
  const { api } = useBackend();
  const [cardPresent, setCardPresent] = useState(false);

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
        <div className="startup-landing-divider">{t('startupLanding.workflow')}</div>
        <div className="startup-landing-steps">{STEPS.map((s, i) => renderStep(s, i + 1))}</div>

        <div className="startup-landing-divider">{t('startupLanding.tools')}</div>
        <div className="startup-landing-steps">{TOOLS.map((s) => renderStep(s))}</div>
      </div>
    </div>
  );
}
