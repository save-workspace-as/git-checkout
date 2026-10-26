import { strict as assert } from 'node:assert';
import { before, beforeEach, describe, it } from 'node:test';
import type { GraphCommitDto } from '../../src/shared/graph/graphProtocol';
import { installDom, resetDom } from '../testing/dom';

let mountCommitFilesView: typeof import('./commitFilesView').mountCommitFilesView;

before(async () => {
  installDom();
  ({ mountCommitFilesView } = await import('./commitFilesView'));
});
beforeEach(resetDom);

function commit(authorEmail: string): GraphCommitDto {
  return {
    sha: 'abc', parents: [], subject: 'Example', author: 'Ada Lovelace',
    authorEmail, authorDate: 0, refs: [],
  };
}

describe('commit summary avatars', () => {
  it('shows the author picture once the graph has looked it up', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const view = mountCommitFilesView(root, () => undefined);
    view.applyHostMessage({ type: 'commitDetailsPreview', commit: commit('Ada@example.com') });
    assert.equal(root.querySelector('img') === null, true);
    view.applyHostMessage({
      type: 'graphAvatars',
      avatars: { 'ada@example.com': 'https://avatars.githubusercontent.com/u/1' },
    });
    assert.equal(root.querySelector('img')?.getAttribute('src'), 'https://avatars.githubusercontent.com/u/1');
  });
});
