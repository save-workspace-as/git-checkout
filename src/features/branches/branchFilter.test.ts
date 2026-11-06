import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import type { RefsSnapshotDto } from '../../shared/branches/refsProtocol';
import { filterBranches, refsFilteredOut, STALE_AFTER_SECONDS, type BranchActivity } from './branchFilter';

const NOW = 2_000_000_000;
const branch = (name: string, isHead = false) => ({ name, shortSha: 'abc', upstream: null, upstreamTrack: null, isHead });
const remote = (name: string) => ({ name, shortSha: 'abc', remote: 'origin' });
const snapshot: RefsSnapshotDto = {
  branches: [branch('main', true), branch('mine'), branch('theirs'), branch('old')],
  remoteBranches: [remote('origin/mine'), remote('origin/theirs')],
  tags: [], remotes: [], filterRef: '', headRef: 'main',
};
const activity = new Map<string, BranchActivity>([
  ['main', { ref: 'refs/heads/main', time: NOW - STALE_AFTER_SECONDS - 1, mine: false }],
  ['mine', { ref: 'refs/heads/mine', time: NOW - 10, mine: true }],
  ['theirs', { ref: 'refs/heads/theirs', time: NOW - 20, mine: false }],
  ['old', { ref: 'refs/heads/old', time: NOW - STALE_AFTER_SECONDS - 1, mine: true }],
  ['origin/mine', { ref: 'refs/remotes/origin/mine', time: NOW - 10, mine: true }],
  ['origin/theirs', { ref: 'refs/remotes/origin/theirs', time: NOW - STALE_AFTER_SECONDS, mine: false }],
]);
const names = (filter: Parameters<typeof filterBranches>[1]) => {
  const out = filterBranches(snapshot, filter, activity, NOW);
  return [out.branches.map((b) => b.name), out.remoteBranches.map((b) => b.name)];
};

describe('filterBranches', () => {
  it('keeps everything for All', () => {
    assert.equal(filterBranches(snapshot, 'all', new Map(), NOW), snapshot);
  });

  it('keeps the branches that are yours, local and remote, and always the checked-out one', () => {
    assert.deepEqual(names('mine'), [['main', 'mine', 'old'], ['origin/mine']]);
  });

  it('splits active from stale at three months, and still keeps the checked-out branch', () => {
    assert.deepEqual(names('active'), [['main', 'mine', 'theirs'], ['origin/mine', 'origin/theirs']]);
    assert.deepEqual(names('stale'), [['main', 'old'], []]);
  });

  it('hides a branch it knows nothing about', () => {
    assert.deepEqual(filterBranches(snapshot, 'mine', new Map(), NOW).remoteBranches, []);
  });
});

describe('refsFilteredOut', () => {
  it('names the branches the filter leaves out in full, never the checked-out one', () => {
    assert.deepEqual(refsFilteredOut('mine', activity, NOW, 'main'), ['refs/heads/theirs', 'refs/remotes/origin/theirs']);
    assert.deepEqual(refsFilteredOut('stale', activity, NOW, 'mine'), ['refs/heads/theirs', 'refs/remotes/origin/mine', 'refs/remotes/origin/theirs']);
    assert.deepEqual(refsFilteredOut('all', activity, NOW, null), []);
  });
});
