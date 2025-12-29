/**
 * Database Management Module
 *
 * Interactive database management UI.
 * Equivalent to hantera_ansikten.py menu-driven interface.
 */

export default {
  id: 'database-management',
  title: 'Database Management',
  defaultSize: { width: 700, height: 800 },

  /**
   * Initialize database management module
   * @param {HTMLElement} container - Module container
   * @param {object} api - Module API
   * @returns {Promise<Function>} Cleanup function
   */
  async init(container, api) {
    console.log('[DatabaseManagement] Initializing...');

    // Module state
    let databaseState = null;
    let peopleNames = [];

    // Create UI
    container.innerHTML = `
      <div class="db-management">
        <div class="db-header">
          <h3>Database Management</h3>
          <button class="btn-reload">Reload Database</button>
        </div>

        <!-- Current State Display -->
        <div class="db-state">
          <h4>Current Database</h4>
          <div class="db-stats">Loading...</div>
          <div class="people-list"></div>
        </div>

        <!-- Operations Panel -->
        <div class="operations-panel">
          <h4>Operations</h4>

          <!-- 1. Rename Person -->
          <div class="operation-form">
            <h5>1. Rename Person</h5>
            <div class="form-row">
              <input list="people-list" class="old-name" placeholder="Current name" />
              <span>→</span>
              <input class="new-name" placeholder="New name" />
              <button class="btn-rename">Rename</button>
            </div>
          </div>

          <!-- 2. Merge People -->
          <div class="operation-form">
            <h5>2. Merge People</h5>
            <div class="form-column">
              <input list="people-list" class="merge-source-1" placeholder="First person" />
              <input list="people-list" class="merge-source-2" placeholder="Second person" />
              <input class="merge-target" placeholder="Result name (optional)" />
              <button class="btn-merge">Merge</button>
            </div>
          </div>

          <!-- 3. Delete Person -->
          <div class="operation-form">
            <h5>3. Delete Person</h5>
            <div class="form-row">
              <input list="people-list" class="delete-name" placeholder="Person to delete" />
              <button class="btn-delete">Delete</button>
            </div>
          </div>

          <!-- 4. Move to Ignore -->
          <div class="operation-form">
            <h5>4. Move to Ignored</h5>
            <div class="form-row">
              <input list="people-list" class="ignore-name" placeholder="Person name" />
              <button class="btn-move-ignore">Move to Ignored</button>
            </div>
          </div>

          <!-- 5. Move from Ignore -->
          <div class="operation-form">
            <h5>5. Move from Ignored</h5>
            <div class="form-row">
              <input type="number" class="ignore-count" placeholder="Count (-1 for all)" min="-1" />
              <span>→</span>
              <input class="ignore-target" placeholder="New person name" />
              <button class="btn-move-from-ignore">Move from Ignored</button>
            </div>
          </div>

          <!-- 8/10. Undo File -->
          <div class="operation-form">
            <h5>8/10. Undo File Processing</h5>
            <div class="form-column">
              <input class="undo-pattern" placeholder="Filename or glob (e.g., 2024*.NEF)" />
              <div class="button-row">
                <button class="btn-undo">Undo</button>
                <button class="btn-recent-files">Show Recent Files</button>
              </div>
            </div>
          </div>

          <!-- 9. Purge Encodings -->
          <div class="operation-form">
            <h5>9. Purge Last X Encodings</h5>
            <div class="form-row">
              <input list="people-list-with-ignore" class="purge-name" placeholder="Person or 'ignore'" />
              <input type="number" class="purge-count" placeholder="Count to remove" min="1" />
              <button class="btn-purge">Purge</button>
            </div>
          </div>
        </div>

        <!-- Status/Results Display -->
        <div class="operation-status"></div>
      </div>
    `;

    // Create datalists for autocomplete
    const datalist = document.createElement('datalist');
    datalist.id = 'people-list';
    container.appendChild(datalist);

    const datalistWithIgnore = document.createElement('datalist');
    datalistWithIgnore.id = 'people-list-with-ignore';
    container.appendChild(datalistWithIgnore);

    // Add styles
    const style = document.createElement('style');
    style.textContent = `
      .db-management {
        height: 100%;
        display: flex;
        flex-direction: column;
        padding: 12px;
        overflow-y: auto;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }

      .db-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
        padding-bottom: 8px;
        border-bottom: 2px solid #e0e0e0;
      }

      .db-header h3 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
      }

      .btn-reload {
        padding: 6px 12px;
        background: #2196F3;
        color: white;
        border: none;
        border-radius: 3px;
        cursor: pointer;
        font-size: 13px;
      }

      .btn-reload:hover {
        background: #1976D2;
      }

      .db-state {
        background: #f9f9f9;
        border: 1px solid #e0e0e0;
        border-radius: 4px;
        padding: 12px;
        margin-bottom: 16px;
      }

      .db-state h4 {
        margin: 0 0 8px 0;
        font-size: 14px;
        font-weight: 600;
        color: #388E3C;
      }

      .db-stats {
        font-size: 13px;
        color: #666;
        margin-bottom: 12px;
      }

      .people-list {
        max-height: 200px;
        overflow-y: auto;
        font-size: 12px;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: 4px;
      }

      .person-item {
        padding: 4px 8px;
        background: white;
        border: 1px solid #e0e0e0;
        border-radius: 3px;
      }

      .operations-panel {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .operations-panel h4 {
        margin: 0 0 8px 0;
        font-size: 14px;
        font-weight: 600;
        color: #388E3C;
      }

      .operation-form {
        background: #f9f9f9;
        border: 1px solid #e0e0e0;
        border-radius: 4px;
        padding: 12px;
      }

      .operation-form h5 {
        margin: 0 0 8px 0;
        font-size: 13px;
        font-weight: 600;
        color: #333;
      }

      .form-row {
        display: flex;
        gap: 8px;
        align-items: center;
      }

      .form-column {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .button-row {
        display: flex;
        gap: 8px;
      }

      .operation-form input {
        flex: 1;
        padding: 6px 8px;
        border: 1px solid #ccc;
        border-radius: 3px;
        font-size: 13px;
      }

      .operation-form input:focus {
        outline: none;
        border-color: #2196F3;
      }

      .operation-form button {
        padding: 6px 12px;
        background: #4CAF50;
        color: white;
        border: none;
        border-radius: 3px;
        cursor: pointer;
        font-size: 13px;
        white-space: nowrap;
      }

      .operation-form button:hover {
        background: #45a049;
      }

      .btn-delete,
      .btn-purge {
        background: #f44336;
      }

      .btn-delete:hover,
      .btn-purge:hover {
        background: #da190b;
      }

      .btn-recent-files {
        background: #FF9800;
      }

      .btn-recent-files:hover {
        background: #F57C00;
      }

      .operation-status {
        margin-top: 16px;
        padding: 12px;
        border-radius: 4px;
        font-size: 13px;
      }

      .operation-status.success {
        background: #C8E6C9;
        color: #2E7D32;
        border: 1px solid #81C784;
      }

      .operation-status.error {
        background: #FFCDD2;
        color: #C62828;
        border: 1px solid #E57373;
      }
    `;
    container.appendChild(style);

    // Get DOM elements
    const dbStatsEl = container.querySelector('.db-stats');
    const peopleListEl = container.querySelector('.people-list');
    const statusEl = container.querySelector('.operation-status');

    /**
     * Load database state
     */
    async function loadDatabaseState() {
      try {
        console.log('[DatabaseManagement] Loading database state...');
        const response = await api.http.get('/api/management/database-state');
        databaseState = response;
        renderDatabaseState();
        updateAutocomplete();
        console.log('[DatabaseManagement] Database state loaded');
      } catch (err) {
        console.error('[DatabaseManagement] Failed to load database state:', err);
        showError('Failed to load database state: ' + err.message);
      }
    }

    /**
     * Render database state
     */
    function renderDatabaseState() {
      if (!databaseState) return;

      // Render stats
      dbStatsEl.innerHTML = `
        <strong>${databaseState.people.length}</strong> people,
        <strong>${databaseState.ignored_count}</strong> ignored encodings,
        <strong>${databaseState.processed_files_count}</strong> files processed
      `;

      // Render people list
      peopleListEl.innerHTML = '';
      databaseState.people.forEach(person => {
        const item = document.createElement('div');
        item.className = 'person-item';
        item.textContent = `${person.name} (${person.encoding_count})`;
        peopleListEl.appendChild(item);
      });
    }

    /**
     * Update autocomplete datalists
     */
    function updateAutocomplete() {
      if (!databaseState) return;

      peopleNames = databaseState.people.map(p => p.name);

      // Update people-list
      datalist.innerHTML = '';
      peopleNames.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        datalist.appendChild(option);
      });

      // Update people-list-with-ignore
      datalistWithIgnore.innerHTML = '';
      peopleNames.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        datalistWithIgnore.appendChild(option);
      });
      const ignoreOption = document.createElement('option');
      ignoreOption.value = 'ignore';
      datalistWithIgnore.appendChild(ignoreOption);
    }

    /**
     * Show success message
     */
    function showSuccess(message) {
      statusEl.className = 'operation-status success';
      statusEl.textContent = message;
      setTimeout(() => {
        statusEl.className = 'operation-status';
        statusEl.textContent = '';
      }, 5000);
    }

    /**
     * Show error message
     */
    function showError(message) {
      statusEl.className = 'operation-status error';
      statusEl.textContent = message;
    }

    // ===== Operation Handlers =====

    /** 1. Rename Person */
    async function handleRename() {
      const oldName = container.querySelector('.old-name').value.trim();
      const newName = container.querySelector('.new-name').value.trim();

      if (!oldName || !newName) {
        showError('Please enter both old and new names');
        return;
      }

      if (!confirm(`Rename '${oldName}' to '${newName}'?`)) return;

      try {
        const result = await api.http.post('/api/management/rename-person', {
          old_name: oldName,
          new_name: newName
        });

        showSuccess(result.message);
        databaseState = result.new_state;
        renderDatabaseState();
        updateAutocomplete();

        container.querySelector('.old-name').value = '';
        container.querySelector('.new-name').value = '';
      } catch (err) {
        showError('Rename failed: ' + err.message);
      }
    }

    /** 2. Merge People */
    async function handleMerge() {
      const source1 = container.querySelector('.merge-source-1').value.trim();
      const source2 = container.querySelector('.merge-source-2').value.trim();
      let target = container.querySelector('.merge-target').value.trim();

      if (!source1 || !source2) {
        showError('Please enter two people to merge');
        return;
      }

      if (!target) {
        target = source1;
      }

      if (!confirm(`Merge '${source1}' and '${source2}' into '${target}'?`)) return;

      try {
        const result = await api.http.post('/api/management/merge-people', {
          source_names: [source1, source2],
          target_name: target
        });

        showSuccess(result.message);
        databaseState = result.new_state;
        renderDatabaseState();
        updateAutocomplete();

        container.querySelector('.merge-source-1').value = '';
        container.querySelector('.merge-source-2').value = '';
        container.querySelector('.merge-target').value = '';
      } catch (err) {
        showError('Merge failed: ' + err.message);
      }
    }

    /** 3. Delete Person */
    async function handleDelete() {
      const name = container.querySelector('.delete-name').value.trim();

      if (!name) {
        showError('Please enter person name to delete');
        return;
      }

      if (!confirm(`Delete '${name}'? This will permanently remove all their encodings.`)) return;

      try {
        const result = await api.http.post('/api/management/delete-person', {
          name: name
        });

        showSuccess(result.message);
        databaseState = result.new_state;
        renderDatabaseState();
        updateAutocomplete();

        container.querySelector('.delete-name').value = '';
      } catch (err) {
        showError('Delete failed: ' + err.message);
      }
    }

    /** 4. Move to Ignore */
    async function handleMoveToIgnore() {
      const name = container.querySelector('.ignore-name').value.trim();

      if (!name) {
        showError('Please enter person name');
        return;
      }

      if (!confirm(`Move '${name}' to ignored list?`)) return;

      try {
        const result = await api.http.post('/api/management/move-to-ignore', {
          name: name
        });

        showSuccess(result.message);
        databaseState = result.new_state;
        renderDatabaseState();
        updateAutocomplete();

        container.querySelector('.ignore-name').value = '';
      } catch (err) {
        showError('Move to ignore failed: ' + err.message);
      }
    }

    /** 5. Move from Ignore */
    async function handleMoveFromIgnore() {
      const count = parseInt(container.querySelector('.ignore-count').value.trim(), 10);
      const targetName = container.querySelector('.ignore-target').value.trim();

      if (isNaN(count) || !targetName) {
        showError('Please enter count and target name');
        return;
      }

      if (!confirm(`Move ${count === -1 ? 'all' : count} encodings from ignored to '${targetName}'?`)) return;

      try {
        const result = await api.http.post('/api/management/move-from-ignore', {
          count: count,
          target_name: targetName
        });

        showSuccess(result.message);
        databaseState = result.new_state;
        renderDatabaseState();
        updateAutocomplete();

        container.querySelector('.ignore-count').value = '';
        container.querySelector('.ignore-target').value = '';
      } catch (err) {
        showError('Move from ignore failed: ' + err.message);
      }
    }

    /** 8/10. Undo File */
    async function handleUndo() {
      const pattern = container.querySelector('.undo-pattern').value.trim();

      if (!pattern) {
        showError('Please enter filename or pattern');
        return;
      }

      if (!confirm(`Undo processing for files matching '${pattern}'?`)) return;

      try {
        const result = await api.http.post('/api/management/undo-file', {
          filename_pattern: pattern
        });

        showSuccess(result.message + (result.files_undone ? '\\nFiles: ' + result.files_undone.join(', ') : ''));
        databaseState = result.new_state;
        renderDatabaseState();
        updateAutocomplete();

        container.querySelector('.undo-pattern').value = '';
      } catch (err) {
        showError('Undo failed: ' + err.message);
      }
    }

    /** Show Recent Files */
    async function handleShowRecentFiles() {
      try {
        const files = await api.http.get('/api/management/recent-files', { n: 10 });
        const fileList = files.map((f, i) => `${i + 1}. ${f.name}`).join('\\n');
        alert(`Recent 10 processed files:\\n\\n${fileList}`);
      } catch (err) {
        showError('Failed to load recent files: ' + err.message);
      }
    }

    /** 9. Purge Encodings */
    async function handlePurge() {
      const name = container.querySelector('.purge-name').value.trim();
      const count = parseInt(container.querySelector('.purge-count').value.trim(), 10);

      if (!name || isNaN(count) || count < 1) {
        showError('Please enter person name and count');
        return;
      }

      if (!confirm(`Remove last ${count} encodings from '${name}'? This cannot be undone.`)) return;

      try {
        const result = await api.http.post('/api/management/purge-encodings', {
          name: name,
          count: count
        });

        showSuccess(result.message);
        databaseState = result.new_state;
        renderDatabaseState();
        updateAutocomplete();

        container.querySelector('.purge-name').value = '';
        container.querySelector('.purge-count').value = '';
      } catch (err) {
        showError('Purge failed: ' + err.message);
      }
    }

    // Event listeners
    container.querySelector('.btn-reload').addEventListener('click', loadDatabaseState);
    container.querySelector('.btn-rename').addEventListener('click', handleRename);
    container.querySelector('.btn-merge').addEventListener('click', handleMerge);
    container.querySelector('.btn-delete').addEventListener('click', handleDelete);
    container.querySelector('.btn-move-ignore').addEventListener('click', handleMoveToIgnore);
    container.querySelector('.btn-move-from-ignore').addEventListener('click', handleMoveFromIgnore);
    container.querySelector('.btn-undo').addEventListener('click', handleUndo);
    container.querySelector('.btn-recent-files').addEventListener('click', handleShowRecentFiles);
    container.querySelector('.btn-purge').addEventListener('click', handlePurge);

    // Initial load
    loadDatabaseState();

    // Listen for database updates from other modules
    api.on('database-updated', () => {
      console.log('[DatabaseManagement] Received database-updated event, reloading...');
      loadDatabaseState();
    });

    // Cleanup function
    return () => {
      console.log('[DatabaseManagement] Cleaning up...');
    };
  },

  /**
   * Get current state for persistence
   * @returns {object} Serializable state
   */
  getState() {
    return {};
  },

  /**
   * Restore state from persistence
   * @param {object} state - Saved state
   */
  setState(state) {
    // No state to restore
  }
};
