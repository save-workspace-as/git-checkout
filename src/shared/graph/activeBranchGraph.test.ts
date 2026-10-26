import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { ALL_COMMITS_FILTER, type GraphRefDto } from './graphProtocol';
import { compactGraphRefs, graphLogRevision, visibleGraphRefs } from './activeBranchGraph';

const refs: GraphRefDto[] = [
  { kind: 'local', name: 'main', isHead: true },
  { kind: 'local', name: 'feature' },
  { kind: 'remote', name: 'origin/main' },
  { kind: 'tag', name: 'v1' },
  { kind: 'head', name: 'HEAD' },
];

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

describe('visibleGraphRefs', () => {
  it('returns every ref when all branches are shown', () => {
    assert.deepEqual(visibleGraphRefs(refs, false), refs);
  });

  it('hides other branches and keeps the checked-out branch, tags, and detached HEAD', () => {
    assert.deepEqual(visibleGraphRefs(refs, true), [
      { kind: 'local', name: 'main', isHead: true },
      { kind: 'tag', name: 'v1' },
      { kind: 'head', name: 'HEAD' },
    ]);
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
