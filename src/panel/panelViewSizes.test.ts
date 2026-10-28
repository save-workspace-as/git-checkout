import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const manifest = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as {
  contributes: {
    viewsContainers: { panel: { id: string }[] };
    views: Record<string, { id: string; initialSize?: number }[]>;
  };
};

/**
 * VS Code splits a container by `initialSize`, and gives a view without one a weight of 20. A container that sizes only its
 * webview (3) leaves it a sliver beside trees that default to 20.
 */
describe('bottom panel view sizes', () => {
  for (const { id } of manifest.contributes.viewsContainers.panel) {
    it(`sizes every view of ${id}`, () => {
      const views = manifest.contributes.views[id];
      assert.ok(views.length > 0);
      for (const view of views) {
        assert.equal(typeof view.initialSize, 'number', `${view.id} needs an initialSize`);
      }
    });
  }
});
