/**
 * Re-apply current translated tab titles to a persisted FlexLayout model.
 *
 * FlexLayout serializes each tab's `name` string into the saved layout, so a
 * layout saved before a translation landed keeps its stale (e.g. English) tab
 * label forever — `Model.fromJson` never re-runs the translation. This walks the
 * parsed layout tree and overwrites every known module tab's `name` from the
 * given `titles` map (keyed by the tab's `component`/`moduleId`), so restored
 * layouts pick up the current language.
 *
 * Mutates `config` in place (and returns it). Tabs whose component is absent
 * from `titles` (non-module tabs) are left untouched. Known module tabs always
 * reflect the module's current translated title — tab renaming is disabled for
 * them anyway (global `tabEnableRename: false`), so no user rename is lost.
 *
 * @param {object} config - parsed FlexLayout JSON ({ layout, borders, ... })
 * @param {Record<string,string>} titles - moduleId -> translated title
 * @returns {object} the same config, mutated
 */
export function retranslateTabNames(config, titles) {
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'tab') {
      const moduleId = node.component || node.config?.moduleId;
      if (moduleId && titles && titles[moduleId]) {
        node.name = titles[moduleId];
      }
    }
    if (Array.isArray(node.children)) node.children.forEach(visit);
  };
  if (config) {
    visit(config.layout);
    (config.borders || []).forEach(visit);
  }
  return config;
}
