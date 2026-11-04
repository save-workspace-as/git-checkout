import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import type { GraphCommitDto } from '../../src/shared/graph/graphProtocol';
import { headHistory } from './headHistory';

const commit = (sha: string, parents: string[], isHead = false): GraphCommitDto => ({
  sha, parents, subject: sha, author: '', authorEmail: '', authorDate: 0,
  refs: isHead ? [{ kind: 'local', name: 'main', isHead: true }] : [],
});

describe('headHistory', () => {
  it('reaches the checked-out commit and its ancestors, through both parents of a merge, and not other branches', () => {
    const commits = [commit('topic', ['base']), commit('merge', ['a', 'side'], true), commit('side', ['base']), commit('a', ['base']), commit('base', [])];
    assert.deepEqual([...headHistory(commits)!].sort(), ['a', 'base', 'merge', 'side']);
  });

  it('is undefined when the checked-out commit is not drawn, so nothing is dimmed', () => {
    assert.equal(headHistory([commit('x', [])]), undefined);
  });

  it('follows a detached HEAD', () => {
    const detached = { ...commit('d', ['p']), refs: [{ kind: 'head' as const, name: 'HEAD' }] };
    assert.deepEqual([...headHistory([detached, commit('p', [])])!].sort(), ['d', 'p']);
  });
});
