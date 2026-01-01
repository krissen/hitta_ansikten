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
import { debug, debugWarn, debugError } from '../../shared/debug.js';

// Import theme system (must be first to define CSS variables)
import '../../theme.css';
import { themeManager } from '../../theme-manager.js';

// Import FlexLayout CSS
import 'flexlayout-react/style/light.css';

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
            <FlexLayoutWorkspace />
          </ToastProvider>
        </BackendProvider>
      </ModuleAPIProvider>
    </StrictMode>
  );

  debug('FlexLayout', 'Workspace initialized');
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFlexLayoutWorkspace);
} else {
  initFlexLayoutWorkspace();
}

export { initFlexLayoutWorkspace };
