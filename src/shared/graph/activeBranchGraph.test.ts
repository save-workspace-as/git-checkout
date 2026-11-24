import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import type { GraphRefDto } from './graphProtocol';
import { ALL_COMMITS_FILTER } from './graphProtocol';
import { activeBranchLabels, compactGraphRefs, graphLogRevision, withActiveBranchLabels } from './activeBranchGraph';


describe('graphLogRevision', () => {
  it('keeps the chosen filter until active-branch mode is on', () => {
    assert.equal(graphLogRevision(ALL_COMMITS_FILTER, 'main', false), ALL_COMMITS_FILTER);
    assert.equal(graphLogRevision('feature', 'main', false), 'feature');
  });

  it('follows the checked-out branch, or HEAD when detached', () => {
    assert.equal(graphLogRevision(ALL_COMMITS_FILTER, 'main', true), 'main');
    assert.equal(graphLogRevision('feature', 'release', true), 'release');
    assert.equal(graphLogRevision(ALL_COMMITS_FILTER, null, true), 'HEAD');
    assert.equal(graphLogRevision(ALL_COMMITS_FILTER, '  ', true), 'HEAD');
  });
});

describe('compactGraphRefs', () => {
  it('folds a remote-tracking branch into the local branch of the same name', () => {
    const out = compactGraphRefs([
      { kind: 'local', name: 'main', isHead: true },
      { kind: 'remote', name: 'origin/main' },
      { kind: 'remote', name: 'upstream/main' },
      { kind: 'remote', name: 'origin/other' },
    ]);
    assert.deepEqual(out, [
      { kind: 'local', name: 'main', isHead: true, remotes: ['origin/main', 'upstream/main'] },
      { kind: 'remote', name: 'origin/other' },
    ]);
  });
});

describe('activeBranchLabels', () => {
  const refs: GraphRefDto[] = [
    { kind: 'local', name: 'main', isHead: true },
    { kind: 'local', name: 'feature' },
    { kind: 'remote', name: 'origin/main' },
    { kind: 'remote', name: 'origin/feature' },
    { kind: 'remote', name: 'upstream/main' },
    { kind: 'tag', name: 'v1' },
    { kind: 'stash', name: 'stash@{0}' },
  ];

  it('keeps the checked-out branch and its upstream branch only', () => {
    assert.deepEqual(activeBranchLabels(refs, 'origin/main').map((ref) => ref.name), ['main', 'origin/main']);
  });

  it('keeps just the checked-out branch when it has no upstream branch', () => {
    assert.deepEqual(activeBranchLabels(refs, null).map((ref) => ref.name), ['main']);
  });

  it('keeps the detached HEAD label and drops labels of a commit it does not carry', () => {
    assert.deepEqual(activeBranchLabels([{ kind: 'head', name: 'HEAD' }, { kind: 'local', name: 'x' }], null).map((ref) => ref.name), ['HEAD']);
    assert.deepEqual(activeBranchLabels([{ kind: 'tag', name: 'v1' }], null), []);
  });
});

describe('withActiveBranchLabels', () => {
  it('names the labels it leaves out, and adds nothing when none are left out', () => {
    const commit = { sha: 'a', refs: [{ kind: 'local', name: 'main', isHead: true }, { kind: 'local', name: 'x' }, { kind: 'tag', name: 'v1' }] as GraphRefDto[] };
    const shown = withActiveBranchLabels(commit, null);
    assert.deepEqual(shown.refs.map((ref) => ref.name), ['main']);
    assert.deepEqual(shown.hiddenRefs, ['x', 'v1']);
    assert.equal('hiddenRefs' in withActiveBranchLabels({ sha: 'b', refs: [commit.refs[0]] }, null), false);
  });
});
