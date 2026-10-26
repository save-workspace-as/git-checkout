import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mockCliRegistry, mockGitCli } from '../../core/testing/serviceTestUtils';
import { CommitTreeService, parseLsTreeNames, parseRevisionCommit } from './commitTreeService';

describe('parseLsTreeNames', () => {
  it('splits NUL-separated paths and keeps spaces', () => {
    assert.deepEqual(parseLsTreeNames('a.txt\0dir/b.txt\0my file.txt\0'), [
      'a.txt',
      'dir/b.txt',
      'my file.txt',
    ]);
  });

  it('returns nothing for empty output', () => {
    assert.deepEqual(parseLsTreeNames(''), []);
    assert.deepEqual(parseLsTreeNames('\0'), []);
  });
});

describe('parseRevisionCommit', () => {
  it('reads author, date and subject, and ignores output that is not a commit', () => {
    const sha = 'a'.repeat(40);
    assert.deepEqual(parseRevisionCommit(`${sha}\x00Ann\x00ann@example.com\x00100\x00Fix the thing\n`), {
      sha, author: 'Ann', email: 'ann@example.com', date: 100, subject: 'Fix the thing',
    });
    assert.equal(parseRevisionCommit(''), undefined);
    assert.equal(parseRevisionCommit('not-a-sha\0x\0y\0z\0w'), undefined);
  });
});

describe('CommitTreeService', () => {
  const repoRoot = '/repo';

  it('lists every file at the revision in one go', async () => {
    const recorded = mockGitCli({
      execRead: async (args) => {
        if (args[0] === 'log') {
          return { stdout: '' };
        }
        assert.deepEqual(args, ['ls-tree', '-r', '-z', '--name-only', 'HEAD']);
        return { stdout: 'a.txt\0dir/b.txt\0dir/c.txt\0' };
      },
    });
    const service = new CommitTreeService(mockCliRegistry(repoRoot, recorded.cli));
    assert.deepEqual(await service.list(repoRoot, 'HEAD'), {
      revision: 'HEAD',
      paths: ['a.txt', 'dir/b.txt', 'dir/c.txt'],
    });
  });

  it('uses HEAD when the revision is blank and surfaces git failures', async () => {
    const recorded = mockGitCli({
      execRead: async () => {
        throw new Error('bad revision');
      },
    });
    const service = new CommitTreeService(mockCliRegistry(repoRoot, recorded.cli));
    await assert.rejects(() => service.list(repoRoot, '   '), /bad revision/);
    assert.deepEqual(recorded.reads[0], ['ls-tree', '-r', '-z', '--name-only', 'HEAD']);
    assert.equal(await service.readCommit(repoRoot, 'main'), undefined);
  });
});
