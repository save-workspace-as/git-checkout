import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { GitCliError } from '../../core/gitCliError';
import { mockCliRegistry, mockGitCli } from '../../core/testing/serviceTestUtils';
import { STASH_LIST_ARGS } from './stashParser';
import { StashService } from './stashService';

const REPO = '/repo';
const SHA = 'a'.repeat(40);

describe('StashService', () => {
  it('lists stashes with the null-separated format', async () => {
    const { reads, cli } = mockGitCli({
      execRead: async () => ({ stdout: ['stash@{0}', SHA, 'On main: wip', ''].join('\0') }),
    });
    const entries = await new StashService(mockCliRegistry(REPO, cli)).list(REPO);
    assert.deepEqual(reads[0], STASH_LIST_ARGS);
    assert.equal(entries[0].selector, 'stash@{0}');
    assert.equal(entries[0].message, 'On main: wip');
  });

  it('stashes everything, optionally including untracked files', async () => {
    const { writes, cli } = mockGitCli();
    const svc = new StashService(mockCliRegistry(REPO, cli));
    await svc.create(REPO, { mode: 'all', message: 'wip', includeUntracked: false });
    await svc.create(REPO, { mode: 'all', message: '', includeUntracked: true });
    assert.deepEqual(writes[0], ['stash', 'push', '-m', 'wip']);
    assert.deepEqual(writes[1], ['stash', 'push', '-u']);
  });

  it('stashes selected paths and refuses an empty path list', async () => {
    const { writes, cli } = mockGitCli();
    const svc = new StashService(mockCliRegistry(REPO, cli));
    await svc.create(REPO, { mode: 'paths', message: 'partial', paths: ['src/a.ts', 'docs/b.md'] });
    assert.deepEqual(writes[0], ['stash', 'push', '-u', '-m', 'partial', '--', 'src/a.ts', 'docs/b.md']);
    await assert.rejects(
      svc.create(REPO, { mode: 'paths', message: '', paths: ['../outside'] }),
      /Invalid working-copy path/,
    );
    await assert.rejects(
      svc.create(REPO, { mode: 'paths', message: '', paths: [] }),
      /at least one file/,
    );
  });

  it('applies with --index and drops from the highest index', async () => {
    const { writes, cli } = mockGitCli({
      execRead: async () => ({ stdout: `${SHA}\n` }),
    });
    const svc = new StashService(mockCliRegistry(REPO, cli));
    await svc.apply(REPO, 'stash@{1}', true);
    await svc.drop(REPO, ['stash@{0}', 'stash@{2}']);
    await svc.clear(REPO);
    assert.deepEqual(writes[0], ['stash', 'apply', '--index', 'stash@{1}']);
    assert.deepEqual(writes[1], ['stash', 'drop', 'stash@{2}']);
    assert.deepEqual(writes[2], ['stash', 'drop', 'stash@{0}']);
    assert.deepEqual(writes[3], ['stash', 'clear']);
  });

  it('restores from the stash trees when apply aborts', async () => {
    const reads: string[][] = [];
    const { cli } = mockGitCli({
      execRead: async (args) => {
        reads.push(args);
        if (args[0] === 'write-tree') {
          return { stdout: 'index1\n' };
        }
        if (args[0] === 'diff' && args.includes('--name-only')) {
          return { stdout: '' };
        }
        return { stdout: '' };
      },
      execWrite: async (args) => {
        if (args[0] === 'stash' && args[1] === 'apply') {
          throw new GitCliError('ExitCode', 'failed', REPO, 'Aborting\n', 1);
        }
      },
    });
    await new StashService(mockCliRegistry(REPO, cli)).apply(REPO, 'stash@{0}', true);
    assert.ok(reads.some((args) => args[0] === 'diff' && args.includes('--name-only')));
  });
});
