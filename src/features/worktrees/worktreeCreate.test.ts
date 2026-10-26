import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, it } from 'node:test';

import {
  formatWorktreeCreatedMessage,
  parseWorktreeCreateArg,
  suggestWorktreePath,
  validateWorktreeCreate,
  validateWorktreeDestination,
  type WorktreeCreateContext,
} from './worktreeCreate';

function context(repoRoot: string, overrides: Partial<WorktreeCreateContext> = {}): WorktreeCreateContext {
  return {
    repoRoot,
    branchNames: ['main', 'agent/feature'],
    worktrees: [{ path: repoRoot, branch: 'refs/heads/main' }],
    ...overrides,
  };
}

describe('suggestWorktreePath', () => {
  it('places the worktree beside the repository', () => {
    assert.equal(suggestWorktreePath('/repos/demo', 'agent/feature'), '/repos/demo-agent-feature');
    assert.equal(suggestWorktreePath('/repos/demo', '   '), '/repos/demo-worktree');
  });
});

describe('formatWorktreeCreatedMessage', () => {
  it('names the branch and folder', () => {
    assert.equal(
      formatWorktreeCreatedMessage({ path: '/repos/demo-topic', newBranch: 'topic', startPoint: 'main' }),
      'Created worktree for topic at /repos/demo-topic.',
    );
    assert.equal(
      formatWorktreeCreatedMessage({ path: '/repos/demo-feature', startPoint: 'feature' }),
      'Created worktree for feature at /repos/demo-feature.',
    );
  });
});

describe('worktree create validation', () => {
  it('accepts a new branch from a start ref and rejects bad names and folders', () => {
    const root = mkdtempSync(join(tmpdir(), 'git-checkout-wt-'));
    try {
      const destination = join(root, '..', `${basename(root)}-topic`);
      const ready = parseWorktreeCreateArg(
        { path: destination, newBranch: ' topic ', startPoint: 'agent/feature' },
        context(root),
      );
      assert.equal(ready.status, 'ready');
      if (ready.status === 'ready') {
        assert.equal(ready.request.newBranch, 'topic');
        assert.equal(ready.request.startPoint, 'agent/feature');
        assert.equal(ready.request.path, destination);
      }

      assert.equal(
        parseWorktreeCreateArg({ kind: 'section', label: 'Worktrees' }, context(root)).status,
        'absent',
      );
      assert.equal(parseWorktreeCreateArg(undefined, context(root)).status, 'absent');

      assert.equal(
        parseWorktreeCreateArg({ path: destination, newBranch: 'bad name', startPoint: 'main' }, context(root))
          .status,
        'invalid',
      );
      assert.deepEqual(
        parseWorktreeCreateArg({ path: destination, newBranch: 'main', startPoint: 'HEAD' }, context(root)),
        { status: 'invalid', message: 'Branch already exists.' },
      );
      assert.deepEqual(
        parseWorktreeCreateArg({ path: destination, newBranch: 'topic', startPoint: '-main' }, context(root)),
        { status: 'invalid', message: 'Enter a start point without spaces or options' },
      );
      assert.deepEqual(
        parseWorktreeCreateArg({ path: root, newBranch: 'topic', startPoint: 'HEAD' }, context(root)),
        { status: 'invalid', message: 'Choose a folder other than the current worktree.' },
      );
      assert.deepEqual(
        parseWorktreeCreateArg({ path: destination, startPoint: 'main' }, context(root)),
        { status: 'invalid', message: 'That branch is already checked out in a worktree.' },
      );

      const headless = parseWorktreeCreateArg(
        { path: destination, newBranch: 'topic', startPoint: 'HEAD' },
        context(root),
      );
      assert.deepEqual(headless, {
        status: 'ready',
        request: { path: destination, newBranch: 'topic' },
      });

      mkdirSync(join(root, 'busy'));
      writeFileSync(join(root, 'busy', 'file.txt'), 'x\n');
      writeFileSync(join(root, 'notes.txt'), 'x\n');
      mkdirSync(join(root, 'empty'));
      assert.equal(
        validateWorktreeDestination(root, join(root, 'busy'), []),
        'Choose an empty folder or a new path.',
      );
      assert.equal(
        validateWorktreeDestination(root, join(root, 'notes.txt'), []),
        'Choose a folder, not a file.',
      );
      assert.equal(validateWorktreeDestination(root, join(root, 'empty'), []), undefined);
      assert.equal(
        validateWorktreeDestination(root, join(root, 'missing', 'child'), []),
        'The parent folder does not exist.',
      );
      assert.equal(validateWorktreeDestination(root, '-hidden', []), 'Enter a folder path without options.');
      assert.equal(validateWorktreeDestination(root, '   ', []), 'Choose a folder for the worktree.');
      assert.equal(
        validateWorktreeCreate({ path: destination }, context(root)),
        'Choose a branch to Checkout.',
      );
      assert.equal(
        validateWorktreeCreate({ path: destination, startPoint: 'missing' }, context(root)),
        'Choose an existing branch.',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
