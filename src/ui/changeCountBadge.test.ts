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

  it('counts only the selected repository, and nothing when counting is off', () => {
    const repos = [{ root: '/a', state: state(1, 2) }, { root: '/b', state: state(0, 4) }];
    assert.equal(changeCountBadge(repos, 'focused', '/a'), 3);
    assert.equal(changeCountBadge(repos, 'focused', '/b'), 4);
    assert.equal(changeCountBadge(repos, 'focused', null), 0);
    assert.equal(changeCountBadge(repos, 'off', '/a'), 0);
  });

  it('reads scm.countBadge: off hides the badge, anything else counts the selected repository', () => {
    assert.equal(parseCountBadgeMode('off'), 'off');
    assert.equal(parseCountBadgeMode('all'), 'focused');
    assert.equal(parseCountBadgeMode('focused'), 'focused');
    assert.equal(parseCountBadgeMode(undefined), 'focused');
  });
});
