/**
 * FlexLayout Workspace Entry Point
 *
 * Boots React and renders the FlexLayoutWorkspace component.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { FlexLayoutWorkspace } from './FlexLayoutWorkspace.jsx';

// Import FlexLayout CSS
import 'flexlayout-react/style/light.css';

/**
 * Initialize the FlexLayout workspace
 */
function initFlexLayoutWorkspace() {
  console.log('[FlexLayout] Initializing workspace...');

  const rootElement = document.getElementById('workspace-root');
  if (!rootElement) {
    console.error('[FlexLayout] Root element not found!');
    return;
  }

  // Create React root and render
  const root = createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <FlexLayoutWorkspace />
    </React.StrictMode>
  );

  console.log('[FlexLayout] Workspace initialized');
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFlexLayoutWorkspace);
} else {
  initFlexLayoutWorkspace();
}

export { initFlexLayoutWorkspace };
