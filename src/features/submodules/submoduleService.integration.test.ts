import { strict as assert } from 'node:assert';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { initTempRepository, runGit, type TempGitRepository } from '../../core/testing/gitRepoHarness';
import { mockCliRegistry, mockGitCli } from '../../core/testing/serviceTestUtils';
import { SubmoduleService } from './submoduleService';

function commitFile(repo: TempGitRepository, name: string, message: string): void {
  writeFileSync(join(repo.repoRoot, name), `${message}\n`);
  runGit(repo.repoRoot, ['add', name]);
  runGit(repo.repoRoot, ['commit', '-m', message]);
}

describe('SubmoduleService integration', () => {
  it('adds a local repository on the selected branch and stages its gitlink', async () => {
    const source = initTempRepository();
    const superproject = initTempRepository();
    try {
      commitFile(source, 'lib.txt', 'lib');
      runGit(source.repoRoot, ['branch', 'topic']);
      const { cli } = mockGitCli({
        execWrite: async (args) => {
          await superproject.cli.execWrite(args, { env: { GIT_ALLOW_PROTOCOL: 'file' } });
        },
        execRead: (args) => superproject.cli.execRead(args),
      });
      const svc = new SubmoduleService(mockCliRegistry(superproject.repoRoot, cli));
      await svc.add(superproject.repoRoot, { url: source.repoRoot, path: 'libs/local lib', branch: 'topic' });
      const modules = await svc.list(superproject.repoRoot);
      assert.equal(modules[0]?.path, 'libs/local lib');
      const config = await superproject.cli.execRead(['config', '-f', '.gitmodules', '--get', 'submodule.libs/local lib.branch']);
      assert.equal(config.stdout.trim(), 'topic');
      const index = await superproject.cli.execRead(['ls-files', '--stage', '--', 'libs/local lib']);
      assert.match(index.stdout, /^160000 /);
    } finally {
      superproject.cleanup();
      source.cleanup();
    }
  });

  it('lists nested submodules and updates them on the host', async () => {
    const lib = initTempRepository();
    const mid = initTempRepository();
    const superproject = initTempRepository();
    try {
      commitFile(lib, 'lib.txt', 'lib');
      runGit(mid.repoRoot, ['config', 'protocol.file.allow', 'always']);
      runGit(mid.repoRoot, [
        '-c',
        'protocol.file.allow=always',
        'submodule',
        'add',
        lib.repoRoot,
        'vendor/lib',
      ]);
      runGit(mid.repoRoot, ['commit', '-m', 'add-lib']);

      const { cli } = mockGitCli({
        execWrite: async (args) => {
          await superproject.cli.execWrite(args, { env: { GIT_ALLOW_PROTOCOL: 'file' } });
        },
        execRead: (args) => superproject.cli.execRead(args),
      });
      const svc = new SubmoduleService(
        mockCliRegistry(superproject.repoRoot, cli),
      );
      await svc.add(superproject.repoRoot, {
        url: mid.repoRoot, path: 'libs/mid', branch: '', recursive: true,
      });
      const listed = await svc.list(superproject.repoRoot);
      assert.deepEqual(
        listed.map((entry) => entry.path).sort(),
        ['libs/mid', 'libs/mid/vendor/lib'],
      );
      assert.equal(listed.every((entry) => entry.status === 'ok'), true);

      await svc.sync(superproject.repoRoot, ['libs/mid']);
      await svc.update(superproject.repoRoot, ['libs/mid']);
      const again = await svc.list(superproject.repoRoot);
      assert.equal(again.length, 2);
    } finally {
      superproject.cleanup();
      mid.cleanup();
      lib.cleanup();
    }
  });

  it('removes a submodule from the index, .gitmodules, and working tree', async () => {
    const source = initTempRepository();
    const superproject = initTempRepository();
    try {
      commitFile(source, 'lib.txt', 'lib');
      const { cli } = mockGitCli({
        execWrite: async (args) => {
          await superproject.cli.execWrite(args, { env: { GIT_ALLOW_PROTOCOL: 'file' } });
        },
        execRead: (args) => superproject.cli.execRead(args),
      });
      const svc = new SubmoduleService(mockCliRegistry(superproject.repoRoot, cli));
      await svc.add(superproject.repoRoot, { url: source.repoRoot, path: 'libs/lib', branch: '' });
      runGit(superproject.repoRoot, ['commit', '-m', 'add-submodule']);
      await svc.remove(superproject.repoRoot, 'libs/lib');
      assert.deepEqual(await svc.list(superproject.repoRoot), []);
      assert.equal(existsSync(join(superproject.repoRoot, 'libs/lib')), false);
      const index = await superproject.cli.execRead(['ls-files', '--stage', '--', 'libs/lib']);
      assert.equal(index.stdout.trim(), '');
      const status = await superproject.cli.execRead(['status', '--porcelain']);
      assert.match(status.stdout, /^D {2}libs\/lib$/m);
      const modules = await superproject.cli.execRead(['show', ':.gitmodules']);
      assert.doesNotMatch(modules.stdout, /libs\/lib/);
    } finally {
      superproject.cleanup();
      source.cleanup();
    }
  });
});