import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { initTempRepository, runGit } from '../../core/testing/gitRepoHarness';
import { mockCliRegistry } from '../../core/testing/serviceTestUtils';
import { HousekeepingService } from './housekeepingService';

function service(repo: ReturnType<typeof initTempRepository>): HousekeepingService {
  return new HousekeepingService(mockCliRegistry(repo.repoRoot, repo.cli));
}

describe('HousekeepingService with real git', () => {
  it('lists merged branches and deletes the ones chosen, leaving unmerged work alone', async () => {
    const repo = initTempRepository();
    try {
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'init']);
      runGit(repo.repoRoot, ['branch', 'merged-topic']);
      runGit(repo.repoRoot, ['checkout', '-b', 'unmerged-topic']);
      writeFileSync(join(repo.repoRoot, 'work.txt'), 'work\n');
      runGit(repo.repoRoot, ['add', 'work.txt']);
      runGit(repo.repoRoot, ['commit', '-m', 'work']);
      runGit(repo.repoRoot, ['checkout', '-']);
      const housekeeping = service(repo);
      assert.deepEqual(await housekeeping.mergedBranches(repo.repoRoot), ['merged-topic']);
      await housekeeping.deleteBranches(repo.repoRoot, ['merged-topic']);
      assert.deepEqual(await housekeeping.mergedBranches(repo.repoRoot), []);
      assert.match((await repo.cli.execRead(['branch', '--list', 'unmerged-topic'])).stdout, /unmerged-topic/);
    } finally {
      repo.cleanup();
    }
  });

  it('previews and cleans untracked files and folders, keeping ignored ones unless asked', async () => {
    const repo = initTempRepository();
    try {
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'init']);
      writeFileSync(join(repo.repoRoot, '.gitignore'), 'ignored.log\n');
      runGit(repo.repoRoot, ['add', '.gitignore']);
      runGit(repo.repoRoot, ['commit', '-m', 'ignore']);
      writeFileSync(join(repo.repoRoot, 'scratch.txt'), 'x\n');
      writeFileSync(join(repo.repoRoot, 'ignored.log'), 'x\n');
      mkdirSync(join(repo.repoRoot, 'build'));
      writeFileSync(join(repo.repoRoot, 'build', 'out.js'), 'x\n');
      const housekeeping = service(repo);
      assert.deepEqual((await housekeeping.cleanPreview(repo.repoRoot, false)).sort(), ['build/', 'scratch.txt']);
      assert.deepEqual((await housekeeping.cleanPreview(repo.repoRoot, true)).sort(), ['build/', 'ignored.log', 'scratch.txt']);
      await housekeeping.clean(repo.repoRoot, ['scratch.txt'], false);
      assert.equal(existsSync(join(repo.repoRoot, 'scratch.txt')), false);
      assert.equal(existsSync(join(repo.repoRoot, 'build', 'out.js')), true);
      assert.equal(existsSync(join(repo.repoRoot, 'ignored.log')), true);
    } finally {
      repo.cleanup();
    }
  });

  it('finds the remote-tracking branches whose branch is gone and prunes them', async () => {
    const repo = initTempRepository();
    const remote = initTempRepository();
    try {
      runGit(remote.repoRoot, ['commit', '--allow-empty', '-m', 'init']);
      runGit(remote.repoRoot, ['branch', 'gone-soon']);
      runGit(repo.repoRoot, ['remote', 'add', 'origin', remote.repoRoot]);
      runGit(repo.repoRoot, ['-c', 'protocol.file.allow=always', 'fetch', 'origin']);
      runGit(remote.repoRoot, ['branch', '-D', 'gone-soon']);
      const housekeeping = service(repo);
      assert.deepEqual(await housekeeping.remotes(repo.repoRoot), ['origin']);
      assert.deepEqual(await housekeeping.prunable(repo.repoRoot, 'origin'), ['origin/gone-soon']);
      await housekeeping.prune(repo.repoRoot, 'origin');
      assert.deepEqual(await housekeeping.prunable(repo.repoRoot, 'origin'), []);
    } finally {
      repo.cleanup();
      remote.cleanup();
    }
  });

  it('runs garbage collection without error', async () => {
    const repo = initTempRepository();
    try {
      await service(repo).gc(repo.repoRoot);
    } finally {
      repo.cleanup();
    }
  });

  it('narrows the working tree to chosen folders and widens it again', async () => {
    const repo = initTempRepository();
    try {
      for (const folder of ['app', 'docs']) {
        mkdirSync(join(repo.repoRoot, folder));
        writeFileSync(join(repo.repoRoot, folder, 'file.txt'), folder);
      }
      runGit(repo.repoRoot, ['add', '.']);
      runGit(repo.repoRoot, ['commit', '-m', 'folders']);
      const housekeeping = service(repo);
      assert.deepEqual((await housekeeping.topLevelFolders(repo.repoRoot)).sort(), ['app', 'docs']);
      assert.deepEqual(await housekeeping.sparseFolders(repo.repoRoot), []);
      await housekeeping.setSparseFolders(repo.repoRoot, ['app']);
      assert.deepEqual(await housekeeping.sparseFolders(repo.repoRoot), ['app']);
      assert.equal(existsSync(join(repo.repoRoot, 'docs', 'file.txt')), false);
      assert.equal(existsSync(join(repo.repoRoot, 'app', 'file.txt')), true);
      await housekeeping.disableSparse(repo.repoRoot);
      assert.equal(existsSync(join(repo.repoRoot, 'docs', 'file.txt')), true);
    } finally {
      repo.cleanup();
    }
  });
});

