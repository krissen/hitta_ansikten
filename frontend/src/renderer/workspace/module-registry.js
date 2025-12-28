/**
 * Module Registry
 *
 * Central registry for all workspace modules. Defines the module interface
 * contract and provides module lifecycle management.
 */

const modules = new Map();

/**
 * Module Interface Contract
 *
 * Each module must export an object with:
 * - id: string - Unique module identifier
 * - title: string - Display name
 * - icon: string (optional) - Icon identifier
 * - defaultSize: {width, height} (optional) - Default panel size
 * - init(container, api): Promise<Function> - Initialize module, return cleanup function
 * - getState(): object (optional) - Serialize module state
 * - setState(state): void (optional) - Restore module state
 * - capabilities: object (optional) - Module capabilities metadata
 */

/**
 * Register a module
 * @param {object} module - Module definition
 */
export function registerModule(module) {
  if (!module.id || !module.title || typeof module.init !== 'function') {
    throw new Error('Invalid module: must have id, title, and init function');
  }

  if (modules.has(module.id)) {
    console.warn(`Module ${module.id} already registered, replacing`);
  }

  modules.set(module.id, module);
  console.log(`[ModuleRegistry] Registered module: ${module.id}`);
}

/**
 * Get a registered module by ID
 * @param {string} id - Module ID
 * @returns {object|undefined} Module definition
 */
export function getModule(id) {
  return modules.get(id);
}

/**
 * Get all registered modules
 * @returns {Array} Array of module definitions
 */
export function getAllModules() {
  return Array.from(modules.values());
}

/**
 * Check if a module is registered
 * @param {string} id - Module ID
 * @returns {boolean}
 */
export function hasModule(id) {
  return modules.has(id);
}

/**
 * Unregister a module
 * @param {string} id - Module ID
 */
export function unregisterModule(id) {
  modules.delete(id);
  console.log(`[ModuleRegistry] Unregistered module: ${id}`);
}

/**
 * Clear all registered modules
 */
export function clearModules() {
  modules.clear();
  console.log('[ModuleRegistry] Cleared all modules');
}
