import { describe, it, expect } from 'vitest';

import { retranslateTabNames } from '../src/renderer/workspace/flexlayout/tabNames.js';

// Regression: FlexLayout persists each tab's `name` into the saved layout, so a
// layout saved before a translation landed keeps its stale English label after
// restore (Model.fromJson never re-runs t()). retranslateTabNames re-applies the
// current translated titles to a parsed layout before it becomes a model.
const TITLES = {
  'image-viewer': 'Bildvisare',
  'file-queue': 'Filkö',
  'review-module': 'Granska ansikten',
  'culling': 'Gallra spelare',
};

describe('retranslateTabNames', () => {
  it('overwrites stale tab names from the titles map, keyed by component', () => {
    const config = {
      layout: {
        type: 'row',
        children: [
          { type: 'tabset', children: [{ type: 'tab', name: 'Image Viewer', component: 'image-viewer' }] },
          { type: 'tabset', children: [{ type: 'tab', name: 'File Queue', component: 'file-queue' }] },
        ],
      },
    };

    retranslateTabNames(config, TITLES);

    const names = config.layout.children.map((ts) => ts.children[0].name);
    expect(names).toEqual(['Bildvisare', 'Filkö']);
  });

  it('recurses through nested rows and border tabs', () => {
    const config = {
      layout: {
        type: 'row',
        children: [
          {
            type: 'row',
            children: [
              { type: 'tabset', children: [{ type: 'tab', name: 'Face Review', component: 'review-module' }] },
            ],
          },
        ],
      },
      borders: [
        { type: 'border', children: [{ type: 'tab', name: 'Culling', component: 'culling' }] },
      ],
    };

    retranslateTabNames(config, TITLES);

    expect(config.layout.children[0].children[0].children[0].name).toBe('Granska ansikten');
    expect(config.borders[0].children[0].name).toBe('Gallra spelare');
  });

  it('falls back to config.moduleId when component is absent', () => {
    const config = {
      layout: {
        type: 'row',
        children: [{ type: 'tab', name: 'Image Viewer', config: { moduleId: 'image-viewer' } }],
      },
    };

    retranslateTabNames(config, TITLES);

    expect(config.layout.children[0].name).toBe('Bildvisare');
  });

  it('leaves unknown components untouched', () => {
    const config = {
      layout: {
        type: 'row',
        children: [{ type: 'tab', name: 'My Custom Tab', component: 'not-a-module' }],
      },
    };

    retranslateTabNames(config, TITLES);

    expect(config.layout.children[0].name).toBe('My Custom Tab');
  });

  it('tolerates missing layout/borders without throwing', () => {
    expect(() => retranslateTabNames({}, TITLES)).not.toThrow();
    expect(() => retranslateTabNames(null, TITLES)).not.toThrow();
  });
});
