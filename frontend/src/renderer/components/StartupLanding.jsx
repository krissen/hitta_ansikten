/**
 * StartupLanding - Empty-workspace welcome.
 *
 * Shown by FlexLayoutWorkspace when the app starts with no queue/files, and
 * dismissed once a module opens or an image loads.
 *
 * Scope (PR 6 trim): this is now a pure orientation card — a welcome + a hint
 * pointing at the persistent WorkflowBar. The step grid, the tools grid and the
 * "Fortsätt →" continue row that used to live here were removed because the
 * always-visible WorkflowBar (`components/WorkflowBar.jsx`) already provides the
 * five pipeline steps, the working-set chip with its hand-offs, the continue
 * button and the Verktyg tools menu — at all times, empty workspace or not. The
 * bar is the single source ("en källa") for navigation and continuation;
 * re-rendering any of it here only re-created the duplicate-affordance problem.
 * See docs/dev/ux-principles.md (navigation rule 7).
 */

import React from 'react';
import { t } from '../../i18n/index.js';
import './StartupLanding.css';

export function StartupLanding() {
  return (
    <div className="startup-landing" role="region" aria-label={t('startupLanding.title')}>
      <div className="startup-landing-card">
        <h1 className="startup-landing-title">{t('startupLanding.title')}</h1>
        <p className="startup-landing-subtitle">{t('startupLanding.subtitle')}</p>
        <p className="startup-landing-hint">{t('startupLanding.barHint')}</p>
      </div>
    </div>
  );
}
