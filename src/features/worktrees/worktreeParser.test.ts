import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { worktreeBranchLabel } from '../../shared/worktrees/worktreeProtocol';
import { parseWorktreeList, sameWorktreePath } from './worktreeParser';

const PORCELAIN = `worktree /repos/main
HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
branch refs/heads/main

worktree /repos/feature
HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
branch refs/heads/feature
locked

worktree /repos/detached
HEAD cccccccccccccccccccccccccccccccccccccccc
detached

worktree /repos/bare.git
HEAD dddddddddddddddddddddddddddddddddddddddd
bare
`;

describe('parseWorktreeList', () => {
  const entries = parseWorktreeList(PORCELAIN, '/repos/main');

  it('parses branch, detached, bare, and locked records', () => {
    assert.deepEqual(
      entries.map((entry) => ({
        path: entry.path,
        branch: entry.branch,
        detached: entry.detached,
        bare: entry.bare,
        locked: entry.locked,
        current: entry.current,
      })),
      [
        {
          path: '/repos/main',
          branch: 'refs/heads/main',
          detached: false,
          bare: false,
          locked: false,
          current: true,
        },
        {
          path: '/repos/feature',
          branch: 'refs/heads/feature',
          detached: false,
          bare: false,
          locked: true,
          current: false,
        },
        {
          path: '/repos/detached',
          branch: null,
          detached: true,
          bare: false,
          locked: false,
          current: false,
        },
        {
          path: '/repos/bare.git',
          branch: null,
          detached: false,
          bare: true,
          locked: false,
          current: false,
        },
      ],
    );
  });

  it('keeps a record that does not end with a blank line', () => {
    const parsed = parseWorktreeList(
      'worktree /repos/only\nHEAD abcdef\nbranch refs/heads/only',
      '/elsewhere',
    );
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].branch, 'refs/heads/only');
    assert.equal(parsed[0].current, false);
  });

  it('returns nothing for empty output', () => {
    assert.deepEqual(parseWorktreeList('', '/repos/main'), []);
    assert.deepEqual(parseWorktreeList('\n\n', '/repos/main'), []);
  });
});

describe('sameWorktreePath', () => {
  it('treats a trailing separator as the same folder', () => {
    assert.equal(sameWorktreePath('/repos/main/', '/repos/main'), true);
  });
});

describe('worktreeBranchLabel', () => {
  it('uses the branch name, a detached short sha, or bare', () => {
    assert.equal(
      worktreeBranchLabel({
        branch: 'refs/heads/agent/feature',
        bare: false,
        detached: false,
        head: null,
      }),
      'agent/feature',
    );
    assert.equal(
      worktreeBranchLabel({
        branch: null,
        bare: false,
        detached: true,
        head: 'abcdef1234567890',
      }),
      '(detached abcdef1)',
    );
    assert.equal(
      worktreeBranchLabel({ branch: null, bare: true, detached: false, head: null }),
      '(bare)',
    );
  });
});
