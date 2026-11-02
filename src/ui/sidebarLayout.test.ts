import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
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
