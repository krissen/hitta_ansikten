/**
 * Review Module
 *
 * Interactive UI for reviewing detected faces.
 * - Displays detected faces in a grid
 * - Shows confidence scores
 * - Allows confirming/rejecting face identities
 * - Supports person name input with autocomplete
 */

import { devToolsFocus } from '../../shared/devtools-focus.js';

export default {
  id: 'review-module',
  title: 'Face Review',
  defaultSize: { width: 400, height: 600 },
  preferredSize: {
    width: 200,       // Preferred width in pixels
    minWidth: 120,    // Minimum width
    maxWidth: 400,    // Maximum width
    flexGrow: 0       // 0 = fixed size, doesn't grow with available space
  },
  defaultLayout: {
    row: 1,           // Main row (top)
    col: 1,           // Left column
    colSpan: 1,       // Single column
    ratio: 0.15,      // 15% of row width
    rowRatio: 1.0     // Full height when only row
  },

  /**
   * Initialize Review Module
   * @param {HTMLElement} container - Module container
   * @param {object} api - Module API
   * @returns {Promise<Function>} Cleanup function
   */
  async init(container, api) {
    console.log('[ReviewModule] Initializing...');

    // Module state
    let currentImagePath = null;
    let detectedFaces = [];
    let people = []; // Known people for autocomplete
    let currentFaceIndex = 0; // Currently selected face for keyboard navigation

    // Batch mode: store pending changes (not saved to database until "Save All")
    let pendingConfirmations = []; // { face_id, person_name, image_path }
    let pendingIgnores = []; // { face_id, image_path }

    // Create UI
    container.innerHTML = `
      <div class="review-module">
        <div class="review-header">
          <div class="review-status">No image loaded</div>
        </div>
        <div class="face-grid"></div>
      </div>
    `;

    // Create datalist for autocomplete (shared by all name inputs)
    const datalistId = 'people-names-datalist';
    const datalist = document.createElement('datalist');
    datalist.id = datalistId;
    container.appendChild(datalist);

    // Add styles
    const style = document.createElement('style');
    style.textContent = `
      .review-module {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: #f5f5f5;
        overflow: hidden;
      }

      .review-header {
        padding: 8px 12px;
        background: white;
        border-bottom: 1px solid #ddd;
      }

      .review-header h3 {
        margin: 0 0 8px 0;
        font-size: 16px;
        font-weight: 600;
      }

      .review-status {
        font-size: 11px;
        color: #666;
      }

      .face-grid {
        flex: 1;
        overflow-y: auto;
        padding: 8px;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
        gap: 8px;
        align-content: start;
      }

      .face-card {
        background: white;
        border-radius: 6px;
        padding: 8px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        display: flex;
        flex-direction: column;
        gap: 6px;
        position: relative;
      }

      .face-thumbnail {
        width: 100%;
        aspect-ratio: 1;
        background: #eee;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 48px;
        overflow: hidden;
      }

      .face-thumbnail img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .face-info {
        font-size: 10px;
        color: #666;
      }

      .face-confidence {
        font-weight: 600;
        color: #4caf50;
      }

      .face-actions {
        display: flex;
        gap: 4px;
      }

      .face-actions input {
        flex: 1;
        padding: 4px 6px;
        border: 1px solid #ddd;
        border-radius: 4px;
        font-size: 11px;
        min-width: 0;
      }

      .face-actions button {
        padding: 4px 8px;
        border: none;
        border-radius: 4px;
        font-size: 11px;
        cursor: pointer;
        font-weight: 600;
      }

      .btn-confirm {
        background: #4caf50;
        color: white;
      }

      .btn-confirm:hover {
        background: #45a049;
      }

      .btn-reject {
        background: #f44336;
        color: white;
      }

      .btn-reject:hover {
        background: #da190b;
      }

      .face-card.confirmed {
        border: 2px solid #4caf50;
      }

      .face-card.rejected {
        border: 2px solid #ff9800;
        opacity: 0.7;
      }

      .face-card.active {
        border: 3px solid #2196f3;
        box-shadow: 0 4px 8px rgba(33, 150, 243, 0.3);
      }

      .face-number {
        position: absolute;
        top: 4px;
        left: 4px;
        background: rgba(0, 0, 0, 0.7);
        color: white;
        font-size: 12px;
        font-weight: bold;
        padding: 2px 6px;
        border-radius: 3px;
        z-index: 10;
      }

      .loading {
        text-align: center;
        padding: 32px;
        color: #666;
      }

      .error {
        text-align: center;
        padding: 32px;
        color: #f44336;
      }

      .keyboard-hint {
        position: absolute;
        bottom: 4px;
        right: 4px;
        background: rgba(33, 150, 243, 0.8);
        color: white;
        font-size: 10px;
        padding: 2px 4px;
        border-radius: 2px;
        display: none;
      }

      .face-card.active .keyboard-hint {
        display: block;
      }
    `;
    container.appendChild(style);

    // Get DOM elements
    const statusEl = container.querySelector('.review-status');
    const gridEl = container.querySelector('.face-grid');

    // Load people names for autocomplete
    async function loadPeopleNames() {
      try {
        people = await api.backend.getPeopleNames();
        console.log(`[ReviewModule] Loaded ${people.length} people names for autocomplete`);

        // Update datalist
        datalist.innerHTML = '';
        people.forEach(name => {
          const option = document.createElement('option');
          option.value = name;
          datalist.appendChild(option);
        });
      } catch (err) {
        console.error('[ReviewModule] Failed to load people names:', err);
      }
    }

    // Load people names on init
    loadPeopleNames();

    /**
     * Focus on current face's input field
     */
    function focusCurrentFace() {
      const cards = gridEl.querySelectorAll('.face-card');
      if (cards[currentFaceIndex]) {
        const input = cards[currentFaceIndex].querySelector('input');
        if (input) {
          input.focus();
          input.select(); // Select text for easy replacement
        }
      }
    }

    /**
     * Navigate to next/previous face
     */
    function navigateToFace(direction) {
      const unconfirmedFaces = detectedFaces.filter(f => !f.is_confirmed);
      if (unconfirmedFaces.length === 0) return;

      // Move index
      currentFaceIndex += direction;

      // Wrap around
      if (currentFaceIndex >= detectedFaces.length) currentFaceIndex = 0;
      if (currentFaceIndex < 0) currentFaceIndex = detectedFaces.length - 1;

      // Skip confirmed faces
      let attempts = 0;
      while (detectedFaces[currentFaceIndex]?.is_confirmed && attempts < detectedFaces.length) {
        currentFaceIndex += direction;
        if (currentFaceIndex >= detectedFaces.length) currentFaceIndex = 0;
        if (currentFaceIndex < 0) currentFaceIndex = detectedFaces.length - 1;
        attempts++;
      }

      renderFaceGrid();

      // Notify Image Viewer of active face index (for 'single' bounding box mode)
      api.emit('active-face-changed', { index: currentFaceIndex });
    }

    /**
     * Confirm current face
     */
    function confirmCurrentFace() {
      if (detectedFaces.length === 0) return;

      const face = detectedFaces[currentFaceIndex];
      if (!face || face.is_confirmed) return;

      const cards = gridEl.querySelectorAll('.face-card');
      const input = cards[currentFaceIndex]?.querySelector('input');
      const personName = input?.value?.trim();

      if (personName) {
        confirmFace(face, personName, currentFaceIndex);
      }
    }

    /**
     * Ignore current face
     */
    function ignoreCurrentFace() {
      if (detectedFaces.length === 0) return;

      const face = detectedFaces[currentFaceIndex];
      if (!face || face.is_confirmed) return;

      rejectFace(face, currentFaceIndex);
    }

    /**
     * Keyboard shortcuts
     */
    function handleKeyboard(event) {
      // Check if keyboard event should be ignored (DevTools focused or input focused)
      if (devToolsFocus.shouldIgnoreKeyboardEvent(event)) {
        return;
      }

      // Don't handle if focus is on an input (except for Enter and Escape)
      const activeElement = document.activeElement;
      const isInput = activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA');

      // Navigation shortcuts (work everywhere)
      if (event.key === 'Tab') {
        event.preventDefault();
        navigateToFace(event.shiftKey ? -1 : 1);
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        navigateToFace(1);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        navigateToFace(-1);
        return;
      }

      // Number shortcuts to jump to face
      if (event.key >= '1' && event.key <= '9' && !isInput) {
        event.preventDefault(); // Prevent default browser behavior
        const faceNum = parseInt(event.key);
        if (faceNum <= detectedFaces.length) {
          currentFaceIndex = faceNum - 1;
          renderFaceGrid();
          // Notify Image Viewer of active face change
          api.emit('active-face-changed', { index: currentFaceIndex });
        }
        return;
      }

      // Action shortcuts
      if (event.key === 'Enter') {
        event.preventDefault();
        confirmCurrentFace();
        return;
      }

      if ((event.key === 'a' || event.key === 'A') && !isInput) {
        event.preventDefault();
        confirmCurrentFace();
        return;
      }

      if ((event.key === 'i' || event.key === 'I') && !isInput) {
        event.preventDefault();
        ignoreCurrentFace();
        return;
      }

      // 'r' or 'R' to enter write mode (focus input and clear)
      if ((event.key === 'r' || event.key === 'R') && !isInput) {
        event.preventDefault();
        const currentCard = container.querySelector(`.face-card[data-face-index="${currentFaceIndex}"]`);
        if (currentCard) {
          const input = currentCard.querySelector('input[type="text"]');
          if (input && !detectedFaces[currentFaceIndex]?.is_confirmed) {
            input.focus();
            input.value = '';
          }
        }
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        if (isInput) {
          // Inside input: reset value and blur
          activeElement.value = detectedFaces[currentFaceIndex]?.person_name || '';
          activeElement.blur();
        } else {
          // Outside input: discard all pending changes
          if (pendingConfirmations.length > 0 || pendingIgnores.length > 0) {
            discardAllChanges();
          }
        }
        return;
      }

      // Letter keys: Reserved for shortcuts, no auto-typing
      // User must press 'r' to enter write mode
      // (This section intentionally left minimal to prevent conflicts)
    }

    // Add keyboard listener to document (module-wide shortcuts)
    document.addEventListener('keydown', handleKeyboard);

    /**
     * Update status message
     */
    function updateStatus(message) {
      statusEl.textContent = message;
    }

    /**
     * Render face grid
     */
    function renderFaceGrid() {
      if (detectedFaces.length === 0) {
        gridEl.innerHTML = '<div class="loading">No faces detected</div>';
        currentFaceIndex = 0;
        return;
      }

      gridEl.innerHTML = '';

      detectedFaces.forEach((face, index) => {
        const card = createFaceCard(face, index);
        gridEl.appendChild(card);
      });

      // Ensure current index is valid
      if (currentFaceIndex >= detectedFaces.length) {
        currentFaceIndex = detectedFaces.length - 1;
      }
      if (currentFaceIndex < 0) {
        currentFaceIndex = 0;
      }

      // Don't auto-focus input - user must press 'r' to enter write mode
    }

    /**
     * Create face card element
     */
    function createFaceCard(face, index) {
      const card = document.createElement('div');
      card.className = 'face-card';
      card.dataset.faceIndex = index; // Store index for keyboard navigation
      if (face.is_confirmed && !face.is_rejected) card.classList.add('confirmed');
      if (face.is_rejected) card.classList.add('rejected');
      if (index === currentFaceIndex) card.classList.add('active');

      // Face number badge
      const numberBadge = document.createElement('div');
      numberBadge.className = 'face-number';
      numberBadge.textContent = `${index + 1}`;
      card.appendChild(numberBadge);

      // Keyboard hint (only shown on active card)
      const keyboardHint = document.createElement('div');
      keyboardHint.className = 'keyboard-hint';
      keyboardHint.textContent = 'R=Write A/Enter=Accept I=Ignore';
      card.appendChild(keyboardHint);

      // Thumbnail - load actual face image from API
      const thumbnail = document.createElement('div');
      thumbnail.className = 'face-thumbnail';

      // Build thumbnail URL using api.backend.baseUrl
      const bbox = face.bounding_box;
      const thumbnailUrl = `${api.backend.baseUrl}/api/face-thumbnail?` +
        `image_path=${encodeURIComponent(currentImagePath)}` +
        `&x=${bbox.x}&y=${bbox.y}&width=${bbox.width}&height=${bbox.height}&size=150`;

      // Create img element
      const img = document.createElement('img');
      img.src = thumbnailUrl;
      img.alt = face.person_name || 'Unknown';
      img.onerror = () => {
        // Fallback to placeholder on error
        thumbnail.textContent = '👤';
      };
      thumbnail.appendChild(img);

      // Info
      const info = document.createElement('div');
      info.className = 'face-info';
      info.innerHTML = `
        <div class="face-confidence">Confidence: ${(face.confidence * 100).toFixed(1)}%</div>
        ${face.person_name ? `<div>Person: ${face.person_name}</div>` : ''}
      `;

      // Actions
      const actions = document.createElement('div');
      actions.className = 'face-actions';

      if (!face.is_confirmed) {
        // Name input with autocomplete (no buttons - keyboard only)
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.placeholder = 'Person name...';
        nameInput.value = face.person_name || '';
        nameInput.setAttribute('list', datalistId); // Link to datalist for autocomplete

        actions.appendChild(nameInput);
      } else {
        const statusColor = face.is_rejected ? '#ff9800' : '#4caf50';
        const statusText = face.is_rejected ? '⊘ Ignored' : `✓ Confirmed: ${face.person_name}`;
        actions.innerHTML = `<div style="color: ${statusColor}; font-size: 12px;">${statusText}</div>`;
      }

      card.appendChild(thumbnail);
      card.appendChild(info);
      card.appendChild(actions);

      // Click handler to select this face
      card.addEventListener('click', (e) => {
        // Don't select if clicking on input
        if (e.target.tagName === 'INPUT') {
          return;
        }

        // Set as current face and re-render
        currentFaceIndex = index;
        renderFaceGrid();

        // Notify Image Viewer of active face change
        api.emit('active-face-changed', { index: currentFaceIndex });

        // Don't auto-focus input - user must press 'r' to enter write mode
      });

      return card;
    }

    /**
     * Confirm face identity (batch mode - not saved until "Save All")
     */
    function confirmFace(face, personName, index) {
      if (!personName || !personName.trim()) {
        alert('Please enter a person name');
        return;
      }

      console.log(`[ReviewModule] Confirming face ${face.face_id} as ${personName} (pending save)`);

      // Update local state (not saved to database yet)
      detectedFaces[index].is_confirmed = true;
      detectedFaces[index].person_name = personName.trim();

      // Add to pending confirmations (or update if already exists)
      const existingIndex = pendingConfirmations.findIndex(p => p.face_id === face.face_id);
      if (existingIndex >= 0) {
        pendingConfirmations[existingIndex].person_name = personName.trim();
      } else {
        pendingConfirmations.push({
          face_id: face.face_id,
          person_name: personName.trim(),
          image_path: currentImagePath
        });
      }

      // Re-render
      renderFaceGrid();
      const reviewedCount = detectedFaces.filter(f => f.is_confirmed).length;
      const pendingCount = pendingConfirmations.length + pendingIgnores.length;
      updateStatus(`${reviewedCount}/${detectedFaces.length} reviewed | ${pendingCount} changes pending (NOT SAVED)`);

      // Check if all faces are now confirmed/rejected
      const allDone = detectedFaces.every(f => f.is_confirmed || f.is_rejected);
      if (allDone && (pendingConfirmations.length > 0 || pendingIgnores.length > 0)) {
        console.log('[ReviewModule] All faces reviewed! Auto-saving changes...');
        // Auto-save after a short delay to allow UI to update
        setTimeout(() => {
          saveAllChanges();
        }, 500);
      } else {
        // Move to next unconfirmed face
        navigateToFace(1);
      }

      console.log(`[ReviewModule] Face confirmed locally (${pendingConfirmations.length} confirmations, ${pendingIgnores.length} ignores pending)`);
    }

    /**
     * Reject/ignore face (batch mode - not saved until "Save All")
     */
    function rejectFace(face, index) {
      console.log(`[ReviewModule] Rejecting face ${face.face_id} (pending save)`);

      // Mark as rejected locally (not saved to database yet)
      detectedFaces[index].is_confirmed = true; // Mark as "reviewed"
      detectedFaces[index].is_rejected = true;
      detectedFaces[index].person_name = '(ignored)'; // Show "(ignored)" in UI

      // Add to pending ignores
      const existingIndex = pendingIgnores.findIndex(p => p.face_id === face.face_id);
      if (existingIndex < 0) {
        pendingIgnores.push({
          face_id: face.face_id,
          image_path: currentImagePath
        });
      }

      // Re-render
      renderFaceGrid();
      const reviewedCount = detectedFaces.filter(f => f.is_confirmed).length;
      const pendingCount = pendingConfirmations.length + pendingIgnores.length;
      updateStatus(`${reviewedCount}/${detectedFaces.length} reviewed | ${pendingCount} changes pending (NOT SAVED)`);

      // Check if all faces are now confirmed/rejected
      const allDone = detectedFaces.every(f => f.is_confirmed || f.is_rejected);
      if (allDone && (pendingConfirmations.length > 0 || pendingIgnores.length > 0)) {
        console.log('[ReviewModule] All faces reviewed! Auto-saving changes...');
        // Auto-save after a short delay to allow UI to update
        setTimeout(() => {
          saveAllChanges();
        }, 500);
      } else {
        // Move to next unconfirmed face
        navigateToFace(1);
      }

      console.log(`[ReviewModule] Face rejected locally (${pendingConfirmations.length} confirmations, ${pendingIgnores.length} ignores pending)`);
    }

    /**
     * Save all pending changes to database
     */
    async function saveAllChanges() {
      if (pendingConfirmations.length === 0 && pendingIgnores.length === 0) {
        alert('No changes to save');
        return;
      }

      const totalChanges = pendingConfirmations.length + pendingIgnores.length;
      console.log(`[ReviewModule] Saving ${totalChanges} changes to database...`);

      updateStatus(`Saving ${totalChanges} changes to database...`);

      try {
        // Save all confirmations
        for (const confirmation of pendingConfirmations) {
          await api.backend.confirmIdentity(
            confirmation.face_id,
            confirmation.person_name,
            confirmation.image_path
          );
        }

        // Save all ignores
        for (const ignore of pendingIgnores) {
          await api.backend.ignoreFace(ignore.face_id, ignore.image_path);
        }

        // Clear pending arrays
        pendingConfirmations = [];
        pendingIgnores = [];

        // Reload people names to include newly added people
        await loadPeopleNames();

        // Update UI
        updateStatus(`✅ Successfully saved ${totalChanges} changes to database!`);

        console.log('[ReviewModule] All changes saved successfully');

        // Show success message
        setTimeout(() => {
          updateStatus(`All faces reviewed and saved!`);
        }, 2000);

      } catch (err) {
        console.error('[ReviewModule] Failed to save changes:', err);
        updateStatus('❌ Error saving changes - see console');
        alert(`Failed to save changes: ${err.message}\n\nSome changes may have been saved. Check the console for details.`);
      }
    }

    /**
     * Discard all pending changes
     */
    function discardAllChanges() {
      const totalChanges = pendingConfirmations.length + pendingIgnores.length;

      if (totalChanges === 0) {
        return;
      }

      if (!confirm(`Discard ${totalChanges} unsaved changes?`)) {
        return;
      }

      console.log(`[ReviewModule] Discarding ${totalChanges} pending changes`);

      // Clear pending arrays
      pendingConfirmations = [];
      pendingIgnores = [];

      // Reset face states
      detectedFaces.forEach(face => {
        if (face.is_rejected) {
          face.is_rejected = false;
          face.is_confirmed = false;
          face.person_name = null;
        } else if (face.is_confirmed) {
          face.is_confirmed = false;
          face.person_name = null;
        }
      });

      // Re-render
      renderFaceGrid();
      updateStatus('Changes discarded');

      console.log('[ReviewModule] All changes discarded');
    }

    /**
     * Detect faces in current image
     */
    async function detectFaces(imagePath) {
      console.log(`[ReviewModule] Detecting faces in: ${imagePath}`);
      currentImagePath = imagePath;

      try {
        updateStatus('Detecting faces...');
        gridEl.innerHTML = '<div class="loading">Detecting faces...</div>';

        const result = await api.backend.detectFaces(imagePath, false);

        detectedFaces = result.faces;
        console.log(`[ReviewModule] Found ${detectedFaces.length} faces`);

        // Emit faces to Image Viewer for bounding box overlay
        api.emit('faces-detected', { faces: detectedFaces });

        renderFaceGrid();
        updateStatus(`Found ${detectedFaces.length} faces (${result.processing_time_ms.toFixed(0)}ms)`);

      } catch (err) {
        console.error('[ReviewModule] Face detection failed:', err);
        gridEl.innerHTML = `<div class="error">Face detection failed: ${err.message}</div>`;
        updateStatus('Detection failed');
      }
    }

    // Listen for image-loaded events from Image Viewer
    api.on('image-loaded', ({ imagePath }) => {
      console.log('[ReviewModule] Image loaded event received:', imagePath);
      detectFaces(imagePath);
    });

    // Listen for menu commands
    api.on('save-all-changes', () => {
      console.log('[ReviewModule] Save all changes command received');
      if (pendingConfirmations.length > 0 || pendingIgnores.length > 0) {
        saveAllChanges();
      }
    });

    api.on('discard-changes', () => {
      console.log('[ReviewModule] Discard changes command received');
      if (pendingConfirmations.length > 0 || pendingIgnores.length > 0) {
        discardAllChanges();
      }
    });

    // Listen for backend WebSocket events
    api.ws.on('face-detected', (data) => {
      console.log('[ReviewModule] Face detected event:', data);
      // Could update UI in real-time here
    });

    // Initial state
    updateStatus('Waiting for image...');

    console.log('[ReviewModule] Initialized successfully');

    // Return object with cleanup and state accessor
    return {
      cleanup: () => {
        console.log('[ReviewModule] Cleaning up...');
        document.removeEventListener('keydown', handleKeyboard);
      },
      getState: () => ({
        currentImagePath,
        detectedFaces,
        people,
        currentFaceIndex,
        pendingConfirmations,
        pendingIgnores
      }),
      setState: (state) => {
        if (state.currentImagePath) currentImagePath = state.currentImagePath;
        if (state.detectedFaces) {
          detectedFaces = state.detectedFaces;
          currentFaceIndex = state.currentFaceIndex || 0;
          renderFaceGrid(); // Re-render faces
        }
        if (state.people) people = state.people;
        if (state.pendingConfirmations) pendingConfirmations = state.pendingConfirmations;
        if (state.pendingIgnores) pendingIgnores = state.pendingIgnores;
        updateStatus(`${detectedFaces.length} faces detected`);
      }
    };
  },

  /**
   * Get module state for persistence
   */
  getState() {
    return {};
  },

  /**
   * Restore module state
   */
  setState(state) {
    // State restoration logic
  }
};
