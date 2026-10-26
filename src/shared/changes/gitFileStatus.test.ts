import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  changeStatusCodicon,
  conflictScenarioHighlight,
  gitFileStatusRowClass,
  gitNameStatusHighlight,
  mergeGitFileStatusHighlight,
  vscodeGitDecorationColorId,
  workingCopyStatusHighlight,
  workingCopyStatusLetter,
} from './gitFileStatus';

describe('workingCopyStatusHighlight', () => {
  it('maps working-copy labels to normalized highlights', () => {
    assert.equal(workingCopyStatusHighlight('modified'), 'modified');
    assert.equal(workingCopyStatusHighlight('untracked'), 'untracked');
    assert.equal(workingCopyStatusHighlight('conflict'), 'conflict');
    assert.equal(workingCopyStatusHighlight('renamed'), 'renamed');
  });
});

describe('gitNameStatusHighlight', () => {
  it('reads the first letter of diff-tree status tokens', () => {
    assert.equal(gitNameStatusHighlight('M'), 'modified');
    assert.equal(gitNameStatusHighlight('A'), 'added');
    assert.equal(gitNameStatusHighlight('R100'), 'renamed');
    assert.equal(gitNameStatusHighlight('C075'), 'renamed');
  });
});

describe('mergeGitFileStatusHighlight', () => {
  it('keeps the stronger status when paths overlap', () => {
    assert.equal(mergeGitFileStatusHighlight('modified', 'deleted'), 'deleted');
    assert.equal(mergeGitFileStatusHighlight('added', 'conflict'), 'conflict');
    assert.equal(mergeGitFileStatusHighlight('untracked', 'modified'), 'untracked');
  });
});

describe('presentation helpers', () => {
  it('uses git decoration theme ids and codicons', () => {
    assert.equal(vscodeGitDecorationColorId('untracked'), 'gitDecoration.untrackedResourceForeground');
    assert.equal(vscodeGitDecorationColorId('conflict'), 'gitDecoration.conflictingResourceForeground');
    assert.equal(changeStatusCodicon('deleted'), 'diff-removed');
    assert.equal(gitFileStatusRowClass('added'), 'git-file-row--added');
  });

  it('maps conflict scenarios to highlights', () => {
    assert.equal(conflictScenarioHighlight('both-modified'), 'conflict');
    assert.equal(conflictScenarioHighlight('deleted-by-us'), 'deleted');
    assert.equal(conflictScenarioHighlight('both-added'), 'added');
  });
});

describe('working copy badges', () => {
  it('uses one letter per status, matching the colour of the same letter', () => {
    const cases: [Parameters<typeof workingCopyStatusLetter>[0], string][] = [
      ['modified', 'M'], ['added', 'A'], ['deleted', 'D'], ['renamed', 'R'], ['untracked', 'U'], ['conflict', '!'],
    ];
    for (const [status, letter] of cases) {
      assert.equal(workingCopyStatusLetter(status), letter, status);
      assert.equal(gitNameStatusHighlight(letter), workingCopyStatusHighlight(status), status);
    }
  });
});
