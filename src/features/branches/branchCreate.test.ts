import { AUTO_STASH_MESSAGE_PATTERN } from './autoStash';
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  branchCreateGitArgs,
  executeBranchCreate,
  parseBranchCreateArg,
  validateBranchName,
} from './branchCreate';
import { mockGitCli } from '../../core/testing/serviceTestUtils';

describe('validateBranchName', () => {
  it('requires a name after the prefilled prefix', () => {
    assert.equal(validateBranchName('  '), 'Name is required');
    assert.equal(validateBranchName('user/feat/'), 'Add a name after the prefix');
    assert.equal(validateBranchName('user-feat-'), 'Add a name after the prefix');
    assert.equal(validateBranchName('user/feat/bar'), undefined);
    assert.equal(validateBranchName('-option'), 'Enter a branch name without spaces or options');
  });
});

describe('branchCreateGitArgs', () => {
  it('creates or checks out the branch from the start point', () => {
    assert.deepEqual(
      branchCreateGitArgs({
        name: ' user/feat/bar ',
        startPoint: 'user/feat/foo',
        checkout: false,
        localChanges: 'keep',
      }),
      ['branch', 'user/feat/bar', 'user/feat/foo'],
    );
    assert.deepEqual(
      branchCreateGitArgs({
        name: 'user/feat/bar',
        checkout: true,
        localChanges: 'stash',
      }),
      ['switch', '-c', 'user/feat/bar'],
    );
  });

  it('rejects an unsafe start point', () => {
    assert.throws(
      () =>
        branchCreateGitArgs({
          name: 'topic',
          startPoint: '--orphan',
          checkout: false,
          localChanges: 'keep',
        }),
      /start point/,
    );
  });
});

describe('parseBranchCreateArg', () => {
  it('ignores sidebar nodes and accepts a command payload', () => {
    assert.deepEqual(parseBranchCreateArg(undefined), { status: 'absent' });
    assert.deepEqual(parseBranchCreateArg({ kind: 'section', label: 'Branches' }), { status: 'absent' });
    assert.deepEqual(
      parseBranchCreateArg({
        name: 'agent/next',
        startPoint: 'agent/feature',
        checkout: true,
        localChanges: 'stash',
      }),
      {
        status: 'ready',
        request: {
          name: 'agent/next',
          startPoint: 'agent/feature',
          checkout: true,
          localChanges: 'stash',
        },
      },
    );
  });

  it('rejects a payload that is not a branch name', () => {
    assert.equal(parseBranchCreateArg({ name: 'user/feat/' }).status, 'invalid');
    assert.equal(parseBranchCreateArg({ checkout: true }).status, 'invalid');
    assert.equal(parseBranchCreateArg({ name: 'topic', localChanges: 'wipe' }).status, 'invalid');
  });
});

describe('executeBranchCreate', () => {
  it('creates the branch without touching a clean worktree', async () => {
    const { cli, reads, writes } = mockGitCli();
    await executeBranchCreate(cli, {
      name: 'topic',
      startPoint: 'main',
      checkout: false,
      localChanges: 'keep',
    });
    assert.deepEqual(reads, []);
    assert.deepEqual(writes, [['branch', 'topic', 'main']]);
  });

  it('checks out the new branch and carries local changes when asked to keep them', async () => {
    const { cli, reads, writes } = mockGitCli();
    await executeBranchCreate(cli, {
      name: 'topic',
      checkout: true,
      localChanges: 'keep',
    });
    assert.deepEqual(reads, []);
    assert.deepEqual(writes, [['switch', '-c', 'topic']]);
  });

  it('stashes dirty changes around checkout and pops them', async () => {
    const { cli, writes } = mockGitCli({
      execRead: async () => ({ stdout: ' M notes.txt\n' }),
    });
    await executeBranchCreate(cli, {
      name: 'user/feat/bar',
      startPoint: 'user/feat/foo',
      checkout: true,
      localChanges: 'stash',
    });
    assert.deepEqual(writes.map((write) => (write[0] === 'stash' && write[1] === 'push' ? write.slice(0, 4) : write)), [
      ['stash', 'push', '-u', '-m'],
      ['switch', '-c', 'user/feat/bar', 'user/feat/foo'],
      ['stash', 'pop'],
    ]);
    assert.match(writes[0][4], AUTO_STASH_MESSAGE_PATTERN);
  });

  it('skips stash when the worktree is clean', async () => {
    const { cli, writes } = mockGitCli({
      execRead: async () => ({ stdout: '' }),
    });
    await executeBranchCreate(cli, {
      name: 'topic',
      checkout: true,
      localChanges: 'stash',
    });
    assert.deepEqual(writes, [['switch', '-c', 'topic']]);
  });

  it('discards tracked and untracked changes before creating the branch', async () => {
    const { cli, writes } = mockGitCli({
      execRead: async () => ({ stdout: '?? notes.txt\n' }),
    });
    await executeBranchCreate(cli, {
      name: 'topic',
      checkout: false,
      localChanges: 'discard',
    });
    assert.deepEqual(writes, [
      ['reset', '--hard'],
      ['clean', '-fd'],
      ['branch', 'topic'],
    ]);
  });

  it('restores the stash when creating the branch fails', async () => {
    const { cli, writes } = mockGitCli({
      execRead: async () => ({ stdout: ' M notes.txt\n' }),
      execWrite: async (args) => {
        if (args[0] === 'switch') {
          throw new Error('switch failed');
        }
      },
    });
    await assert.rejects(
      () =>
        executeBranchCreate(cli, {
          name: 'topic',
          checkout: true,
          localChanges: 'stash',
        }),
      /switch failed/,
    );
    assert.deepEqual(writes.map((write) => (write[0] === 'stash' && write[1] === 'push' ? write.slice(0, 4) : write)), [
      ['stash', 'push', '-u', '-m'],
      ['switch', '-c', 'topic'],
      ['stash', 'pop'],
    ]);
    assert.match(writes[0][4], AUTO_STASH_MESSAGE_PATTERN);
  });
});
