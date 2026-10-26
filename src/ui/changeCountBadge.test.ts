import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { changeCountBadge, parseCountBadgeMode, repositoryChangeCount } from './changeCountBadge';

const change = { uri: {}, originalUri: {}, renameUri: undefined, status: 0 } as never;
const state = (index: number, working: number, untracked = 0, merge = 0) => ({
  indexChanges: Array(index).fill(change),
  workingTreeChanges: Array(working).fill(change),
  untrackedChanges: Array(untracked).fill(change),
  mergeChanges: Array(merge).fill(change),
});

describe('change count badge', () => {
  it('counts staged, unstaged, untracked and conflicted changes of a repository', () => {
    assert.equal(repositoryChangeCount(state(2, 3, 1, 1)), 7);
    assert.equal(repositoryChangeCount({}), 0);
  });

  it('adds up every repository, or only the one in use, as scm.countBadge asks', () => {
    const repos = [{ root: '/a', state: state(1, 2) }, { root: '/b', state: state(0, 4) }];
    assert.equal(changeCountBadge(repos, 'all', '/a'), 7);
    assert.equal(changeCountBadge(repos, 'focused', '/b'), 4);
    assert.equal(changeCountBadge(repos, 'focused', null), 0);
    assert.equal(changeCountBadge(repos, 'off', '/a'), 0);
  });

  it('reads the setting, treating anything unknown as all', () => {
    assert.equal(parseCountBadgeMode('focused'), 'focused');
    assert.equal(parseCountBadgeMode('off'), 'off');
    assert.equal(parseCountBadgeMode(undefined), 'all');
    assert.equal(parseCountBadgeMode('weird'), 'all');
  });
});
