import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { mockCliRegistry, mockGitCli } from '../../core/testing/serviceTestUtils';
import { SubmoduleService, updateSubmodulesIfPresent } from './submoduleService';

const REPO = '/repos/main';
const SHA = '0123456789abcdef0123456789abcdef01234567';

describe('SubmoduleService', () => {
  it('adds a submodule and rejects invalid requests before invoking Git', async () => {
    const { cli, writes } = mockGitCli();
    const svc = new SubmoduleService(mockCliRegistry(REPO, cli));
    await svc.add(REPO, { url: 'https://example.test/lib.git', path: 'vendor/lib', branch: 'main' });
    await assert.rejects(svc.add(REPO, { url: '--bad', path: '../outside', branch: '' }));
    assert.deepEqual(writes, [['submodule', 'add', '-b', 'main', '--', 'https://example.test/lib.git', 'vendor/lib']]);
  });

  it('lists recursive submodule status', async () => {
    const { cli, reads } = mockGitCli({
      execRead: async () => ({ stdout: ` ${SHA} libs/mid (heads/main)\n` }),
    });

    it('initializes nested submodules only when recursive fetching is selected', async () => {
      const { cli, writes } = mockGitCli();
      const svc = new SubmoduleService(mockCliRegistry(REPO, cli));
      await svc.add(REPO, {
        url: 'https://example.test/lib.git', path: ' vendor/lib ', branch: '', recursive: true,
      });
      assert.deepEqual(writes, [
        ['submodule', 'add', '--', 'https://example.test/lib.git', 'vendor/lib'],
        ['submodule', 'update', '--init', '--recursive', '--', 'vendor/lib'],
      ]);
    });

    it('surfaces recursive initialization failures', async () => {
      const { cli } = mockGitCli({ execWrite: async (args) => {
        if (args[1] === 'update') { throw new Error('Nested fetch failed'); }
      } });
      const svc = new SubmoduleService(mockCliRegistry(REPO, cli));
      await assert.rejects(svc.add(REPO, {
        url: 'https://example.test/lib.git', path: 'vendor/lib', branch: '', recursive: true,
      }), /Nested fetch failed/);
    });
    const entries = await new SubmoduleService(mockCliRegistry(REPO, cli)).list(REPO);
    assert.deepEqual(reads, [['submodule', 'status', '--recursive']]);
    assert.equal(entries[0]?.path, 'libs/mid');
    assert.equal(entries[0]?.status, 'ok');
  });

  it('inits, updates, and syncs selected paths', async () => {
    const { cli, writes } = mockGitCli();
    const svc = new SubmoduleService(mockCliRegistry(REPO, cli));
    await svc.init(REPO, ['libs/mid']);
    await svc.update(REPO, ['libs/mid', 'libs/mid/vendor/lib']);
    await svc.sync(REPO);
    assert.deepEqual(writes, [
      ['submodule', 'update', '--init', '--recursive', '--', 'libs/mid'],
      ['submodule', 'update', '--recursive', '--', 'libs/mid', 'libs/mid/vendor/lib'],
      ['submodule', 'sync', '--recursive'],
    ]);
  });

  it('skips the history update when there are no submodules', async () => {
    const { cli, writes } = mockGitCli({ execRead: async () => ({ stdout: '' }) });
    await updateSubmodulesIfPresent(cli);
    assert.deepEqual(writes, []);
  });

  it('removes a submodule by deinitializing and removing it from the index', async () => {
    const { cli, writes } = mockGitCli();
    const svc = new SubmoduleService(mockCliRegistry(REPO, cli));
    await svc.remove(REPO, ' libs/mid ');
    assert.deepEqual(writes, [
      ['submodule', 'deinit', '-f', '--', 'libs/mid'],
      ['rm', '-f', '--', 'libs/mid'],
    ]);
  });

  it('rejects unsafe submodule paths before invoking Git', async () => {
    const { cli, writes } = mockGitCli();
    const svc = new SubmoduleService(mockCliRegistry(REPO, cli));
    for (const bad of ['', '  ', '--force', '/abs/path', 'bad\npath']) {
      await assert.rejects(svc.remove(REPO, bad), bad);
    }
    assert.deepEqual(writes, []);
  });

  it('updates recursively when status lists a submodule', async () => {
    const { cli, writes } = mockGitCli({
      execRead: async () => ({ stdout: ` ${SHA} libs/mid\n` }),
    });
    await updateSubmodulesIfPresent(cli);
    assert.deepEqual(writes, [['submodule', 'update', '--init', '--recursive']]);
  });

  it('logs and continues when the history update fails', async () => {
    const { cli } = mockGitCli({
      execRead: async () => {
        throw new Error('status failed');
      },
    });
    await updateSubmodulesIfPresent(cli);
  });
});
