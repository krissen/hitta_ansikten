/**
 * FlexLayout Workspace Entry Point
 *
 * Boots React and renders the FlexLayoutWorkspace component.
 * Pure React implementation - all modules are React components.
 */

import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { FlexLayoutWorkspace } from './FlexLayoutWorkspace.jsx';
import { ModuleAPIProvider } from '../../context/ModuleAPIContext.jsx';
import { BackendProvider } from '../../context/BackendContext.jsx';
import { ToastProvider } from '../../context/ToastContext.jsx';
import { ConfirmProvider } from '../../context/ConfirmContext.jsx';
import { NotificationListener } from '../../components/NotificationListener.jsx';
import { ConnectionStatus } from '../../components/ConnectionStatus.jsx';
import { debug, debugError } from '../../shared/debug.js';
import { createMidiClient } from '../../shared/midi/client.js';

// Import theme system (must be first among CSS imports to define variables)
import '../../theme.css';
import '../../theme-manager.js'; // Side-effect: initializes theme on load

// Shared UI primitives stylesheet (.btn / .icon-btn). Shipped app-wide from the
// root so the design-system styles are present regardless of which modules
// currently consume the primitives. The primitives also import this file
// themselves (esbuild dedupes), so they carry their styles in isolation/tests.
import '../../components/shared/shared.css';

// Import FlexLayout CSS
import 'flexlayout-react/style/light.css';

// FlexLayout chrome + toast overrides — MUST be imported last so its rules
// win over both component CSS and flexlayout-react's default light.css.
import './flexlayout-overrides.css';

/**
 * Initialize the FlexLayout workspace
 */
function initFlexLayoutWorkspace() {
  debug('FlexLayout', 'Initializing workspace...');

  const rootElement = document.getElementById('workspace-root');
  if (!rootElement) {
    debugError('FlexLayout', 'Root element not found!');
    return;
  }

  // Create React root and render with providers
  // StrictMode is now enabled since we use pure React components
  const root = createRoot(rootElement);
  root.render(
    <StrictMode>
      <ModuleAPIProvider>
        <BackendProvider>
          <ToastProvider>
            <ConfirmProvider>
              <NotificationListener />
              <ConnectionStatus />
              <FlexLayoutWorkspace />
            </ConfirmProvider>
          </ToastProvider>
        </BackendProvider>
      </ModuleAPIProvider>
    </StrictMode>
  );

  debug('FlexLayout', 'Workspace initialized');

  // X-TOUCH MINI control surface: always-on Web MIDI. Quiet no-op when the
  // device is absent; statechange drives hot-plug recovery, and the message
  // consumer arrives with the MIDI input layer.
  const midi = createMidiClient({
    log: (msg) => debug('MIDI', msg),
    onStatus: (status, detail) => debug('MIDI', `status ${status}`, detail),
  });
  midi.connect().catch((err) => debugError('MIDI', 'connect failed', err));
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFlexLayoutWorkspace);
} else {
  initFlexLayoutWorkspace();
}

export { initFlexLayoutWorkspace };
