import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  branchRenameCommands,
  executeBranchRename,
  parseBranchRenameArg,
  readBranchUpstream,
} from './branchRename';
import type { GitCli } from '../../core/gitCli';
import { mockGitCli } from '../../core/testing/serviceTestUtils';

describe('parseBranchRenameArg', () => {
  it('treats a sidebar branch as a prompt and a filled form as a request', () => {
    assert.deepEqual(parseBranchRenameArg(undefined), { status: 'absent' });
    assert.deepEqual(parseBranchRenameArg({ kind: 'branch', ref: 'agent/feature' }), {
      status: 'absent',
      oldName: 'agent/feature',
    });
    assert.deepEqual(
      parseBranchRenameArg({ ref: 'agent/feature', name: 'agent/renamed', renameRemote: false }),
      {
        status: 'ready',
        oldName: 'agent/feature',
        request: { name: 'agent/renamed', renameRemote: false },
      },
    );
    assert.equal(parseBranchRenameArg({ name: 'topic' }).status, 'invalid');
    assert.equal(parseBranchRenameArg({ ref: 'topic', name: 'topic' }).status, 'invalid');
    assert.equal(parseBranchRenameArg({ ref: 'topic', name: 'bad name' }).status, 'invalid');
    assert.equal(
      parseBranchRenameArg({ ref: 'topic', name: 'other', renameRemote: 'yes' }).status,
      'invalid',
    );
  });
});

describe('branchRenameCommands', () => {
  it('renames only the local branch unless the remote checkbox is on', () => {
    assert.deepEqual(
      branchRenameCommands('topic', { name: ' topic-next ', renameRemote: false }, {
        remote: 'origin',
        branch: 'topic',
      }),
      [['branch', '-m', 'topic', 'topic-next']],
    );
    assert.deepEqual(
      branchRenameCommands('topic', { name: 'topic-next', renameRemote: true }, {
        remote: 'origin',
        branch: 'topic',
      }),
      [
        ['branch', '-m', 'topic', 'topic-next'],
        ['push', 'origin', 'topic-next:topic-next'],
        ['push', 'origin', '--delete', 'topic'],
        ['branch', '--set-upstream-to', 'origin/topic-next', 'topic-next'],
      ],
    );
  });

  it('skips deleting the remote branch when its name is already the new name', () => {
    assert.deepEqual(
      branchRenameCommands('topic', { name: 'published', renameRemote: true }, {
        remote: 'origin',
        branch: 'published',
      }),
      [
        ['branch', '-m', 'topic', 'published'],
        ['push', 'origin', 'published:published'],
        ['branch', '--set-upstream-to', 'origin/published', 'published'],
      ],
    );
  });

  it('refuses a remote rename when the branch has no upstream', () => {
    assert.throws(
      () => branchRenameCommands('topic', { name: 'topic-next', renameRemote: true }, null),
      /no remote to rename/,
    );
  });
});

describe('readBranchUpstream', () => {
  it('splits an upstream and treats a missing upstream as none', async () => {
    const tracked = mockGitCli({
      execRead: async () => ({ stdout: 'origin/feature/one\n' }),
    });
    assert.deepEqual(await readBranchUpstream(tracked.cli, 'feature/one'), {
      remote: 'origin',
      branch: 'feature/one',
    });

    const localOnly = mockGitCli({
      execRead: async () => {
        throw new Error('no upstream');
      },
    });
    assert.equal(await readBranchUpstream(localOnly.cli, 'topic'), null);
    assert.equal(await readBranchUpstream(localOnly.cli, '-bad'), null);
  });
});

describe('executeBranchRename', () => {
  it('runs the local rename and marks push commands as network', async () => {
    const calls: { args: string[]; network?: boolean }[] = [];
    const cli = {
      execWrite: async (args: string[], options?: { network?: boolean }) => {
        calls.push({ args, network: options?.network });
      },
    } as unknown as GitCli;
    await executeBranchRename(
      cli,
      'topic',
      { name: 'topic-next', renameRemote: true },
      { remote: 'origin', branch: 'topic' },
    );
    assert.deepEqual(
      calls.map((call) => call.args[0]),
      ['branch', 'push', 'push', 'branch'],
    );
    assert.deepEqual(
      calls.map((call) => call.network),
      [false, true, true, false],
    );
  });
});
