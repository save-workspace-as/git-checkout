import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const manifest = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as {
  contributes: { views: Record<string, { id: string; initialSize?: number; visibility?: string }[]> };
};
const views = new Map(manifest.contributes.views['git-checkout'].map((view) => [view.id, view]));

describe('sidebar layout', () => {
  it('sizes every view, gives the working tree the most room, and starts the views of a commit and of the repository collapsed', () => {
    const size = (id: string): number => views.get(id)?.initialSize ?? 0;
    for (const [id, view] of views) {
      assert.equal(typeof view.initialSize, 'number', `${id} needs an initialSize`);
    }
    assert.ok(size('gitCheckout.changes') > size('gitCheckout.commitForm'));
    assert.ok(size('gitCheckout.changes') > size('gitCheckout.repositories'));
    for (const id of ['gitCheckout.commitFiles', 'gitCheckout.tree', 'gitCheckout.sidebar']) {
      assert.ok(size('gitCheckout.changes') >= size(id), id);
    }
    for (const id of ['gitCheckout.commitFiles', 'gitCheckout.tree', 'gitCheckout.sidebar', 'gitCheckout.sidebar.pullRequests']) {
      assert.equal(views.get(id)?.visibility, 'collapsed', id);
    }
    for (const id of ['gitCheckout.repositories', 'gitCheckout.commitForm', 'gitCheckout.changes']) {
      assert.equal(views.get(id)?.visibility, undefined, id);
    }
  });
});

describe('the number on the Git Checkout icon', () => {
  it('is set by the Repositories view alone, since the icon adds up the badges of every view in its container', () => {
    const sources = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? sources(join(dir, entry.name)) : /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [join(dir, entry.name)] : [],
      );
    const setters = sources(join(__dirname, '..')).filter((file) => /\.badge\s*=(?!=)/.test(readFileSync(file, 'utf8')));
    assert.deepEqual(setters.map((file) => file.slice(file.lastIndexOf('src/'))), ['src/ui/gitCheckoutSidebar.ts']);
  });
});
