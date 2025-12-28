/**
 * Review Module
 *
 * Interactive UI for reviewing detected faces.
 * - Displays detected faces in a grid
 * - Shows confidence scores
 * - Allows confirming/rejecting face identities
 * - Supports person name input with autocomplete
 */

export default {
  id: 'review-module',
  title: 'Face Review',
  defaultSize: { width: 400, height: 600 },

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

    // Create UI
    container.innerHTML = `
      <div class="review-module">
        <div class="review-header">
          <h3>Face Review</h3>
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
        padding: 16px;
        background: white;
        border-bottom: 1px solid #ddd;
      }

      .review-header h3 {
        margin: 0 0 8px 0;
        font-size: 16px;
        font-weight: 600;
      }

      .review-status {
        font-size: 12px;
        color: #666;
      }

      .face-grid {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: 16px;
        align-content: start;
      }

      .face-card {
        background: white;
        border-radius: 8px;
        padding: 12px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        display: flex;
        flex-direction: column;
        gap: 8px;
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
        font-size: 12px;
        color: #666;
      }

      .face-confidence {
        font-weight: 600;
        color: #4caf50;
      }

      .face-actions {
        display: flex;
        gap: 8px;
      }

      .face-actions input {
        flex: 1;
        padding: 6px 8px;
        border: 1px solid #ddd;
        border-radius: 4px;
        font-size: 12px;
      }

      .face-actions button {
        padding: 6px 12px;
        border: none;
        border-radius: 4px;
        font-size: 12px;
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
        opacity: 0.5;
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
        const faceNum = parseInt(event.key);
        if (faceNum <= detectedFaces.length) {
          currentFaceIndex = faceNum - 1;
          renderFaceGrid();
        }
        return;
      }

      // Action shortcuts
      if (event.key === 'Enter' && isInput) {
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

      if (event.key === 'Escape' && isInput) {
        event.preventDefault();
        activeElement.value = detectedFaces[currentFaceIndex]?.person_name || '';
        activeElement.blur();
        return;
      }
    }

    // Add keyboard listener to container
    container.addEventListener('keydown', handleKeyboard);

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

      // Focus on active card's input
      focusCurrentFace();
    }

    /**
     * Create face card element
     */
    function createFaceCard(face, index) {
      const card = document.createElement('div');
      card.className = 'face-card';
      card.dataset.faceIndex = index; // Store index for keyboard navigation
      if (face.is_confirmed) card.classList.add('confirmed');
      if (index === currentFaceIndex) card.classList.add('active');

      // Face number badge
      const numberBadge = document.createElement('div');
      numberBadge.className = 'face-number';
      numberBadge.textContent = `${index + 1}`;
      card.appendChild(numberBadge);

      // Keyboard hint (only shown on active card)
      const keyboardHint = document.createElement('div');
      keyboardHint.className = 'keyboard-hint';
      keyboardHint.textContent = 'Enter=OK I=Ignore';
      card.appendChild(keyboardHint);

      // Thumbnail - load actual face image from API
      const thumbnail = document.createElement('div');
      thumbnail.className = 'face-thumbnail';

      // Build thumbnail URL
      const bbox = face.bounding_box;
      const thumbnailUrl = `http://127.0.0.1:5000/api/face-thumbnail?` +
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
        // Name input with autocomplete
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.placeholder = 'Person name...';
        nameInput.value = face.person_name || '';
        nameInput.setAttribute('list', datalistId); // Link to datalist for autocomplete

        // Confirm button
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'btn-confirm';
        confirmBtn.textContent = '✓';
        confirmBtn.title = 'Confirm identity';
        confirmBtn.onclick = () => confirmFace(face, nameInput.value, index);

        // Reject button
        const rejectBtn = document.createElement('button');
        rejectBtn.className = 'btn-reject';
        rejectBtn.textContent = '✗';
        rejectBtn.title = 'Reject/ignore face';
        rejectBtn.onclick = () => rejectFace(face, index);

        actions.appendChild(nameInput);
        actions.appendChild(confirmBtn);
        actions.appendChild(rejectBtn);
      } else {
        actions.innerHTML = `<div style="color: #4caf50; font-size: 12px;">✓ Confirmed</div>`;
      }

      card.appendChild(thumbnail);
      card.appendChild(info);
      card.appendChild(actions);

      return card;
    }

    /**
     * Confirm face identity
     */
    async function confirmFace(face, personName, index) {
      if (!personName || !personName.trim()) {
        alert('Please enter a person name');
        return;
      }

      console.log(`[ReviewModule] Confirming face ${face.face_id} as ${personName}`);

      try {
        updateStatus('Confirming identity...');

        await api.backend.confirmIdentity(face.face_id, personName.trim(), currentImagePath);

        // Update local state
        detectedFaces[index].is_confirmed = true;
        detectedFaces[index].person_name = personName.trim();

        // Reload people names to include newly added person
        loadPeopleNames();

        // Emit event to other modules
        api.emit('face-confirmed', {
          faceId: face.face_id,
          personName: personName.trim(),
          imagePath: currentImagePath
        });

        // Re-render
        renderFaceGrid();
        updateStatus(`${detectedFaces.filter(f => f.is_confirmed).length}/${detectedFaces.length} faces confirmed`);

        console.log('[ReviewModule] Face confirmed successfully');
      } catch (err) {
        console.error('[ReviewModule] Failed to confirm face:', err);
        updateStatus('Error confirming face');
        alert('Failed to confirm face: ' + err.message);
      }
    }

    /**
     * Reject/ignore face
     */
    async function rejectFace(face, index) {
      console.log(`[ReviewModule] Rejecting face ${face.face_id}`);

      try {
        updateStatus('Rejecting face...');

        await api.backend.ignoreFace(face.face_id, currentImagePath);

        // Remove from grid
        detectedFaces.splice(index, 1);

        // Emit event
        api.emit('face-rejected', {
          faceId: face.face_id,
          imagePath: currentImagePath
        });

        // Re-render
        renderFaceGrid();
        updateStatus(`${detectedFaces.length} faces remaining`);

        console.log('[ReviewModule] Face rejected successfully');
      } catch (err) {
        console.error('[ReviewModule] Failed to reject face:', err);
        updateStatus('Error rejecting face');
        alert('Failed to reject face: ' + err.message);
      }
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

    // Listen for backend WebSocket events
    api.ws.on('face-detected', (data) => {
      console.log('[ReviewModule] Face detected event:', data);
      // Could update UI in real-time here
    });

    // Initial state
    updateStatus('Waiting for image...');

    console.log('[ReviewModule] Initialized successfully');

    // Cleanup function
    return () => {
      console.log('[ReviewModule] Cleaning up...');
      // Remove event listeners if needed
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
