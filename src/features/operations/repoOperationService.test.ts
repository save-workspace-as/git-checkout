import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { IDLE_REPO_OPERATION } from '../../shared/history/historyProtocol';
import type { GitCli } from '../../core/gitCli';
import { RepoOperationService } from './repoOperationService';
import { mockCliRegistry, mockGitExtensionService, mockRepository } from '../../core/testing/serviceTestUtils';

const REPO = '/repo';

function layoutGitDir(): { repoRoot: string; gitDir: string; cleanup: () => void } {
  const repoRoot = mkdtempSync(join(tmpdir(), 'git-checkout-op-'));
  const gitDir = join(repoRoot, '.git');
  mkdirSync(gitDir, { recursive: true });
  return {
    repoRoot,
    gitDir,
    cleanup: () => rmSync(repoRoot, { recursive: true, force: true }),
  };
}

describe('RepoOperationService.getStatus', () => {
  it('returns idle when the repository is not open', async () => {
    const svc = new RepoOperationService(mockGitExtensionService([]), mockCliRegistry(REPO, {} as GitCli));
    assert.deepEqual(await svc.getStatus(REPO), IDLE_REPO_OPERATION);
  });

  it('detects an in-progress merge from MERGE_HEAD', async () => {
    const { repoRoot, gitDir, cleanup } = layoutGitDir();
    writeFileSync(join(gitDir, 'MERGE_HEAD'), 'abc\n');

    const cli = {
      resolveGitDirectories: async () => ({ gitDir, commonDir: gitDir }),
      execRead: async () => ({ stdout: '' }),
    } as unknown as GitCli;

    const svc = new RepoOperationService(
      mockGitExtensionService([mockRepository(repoRoot)]),
      mockCliRegistry(repoRoot, cli),
    );

    const status = await svc.getStatus(repoRoot);
    assert.equal(status.active, true);
    assert.equal(status.kind, 'merge');
    assert.match(status.summary, /Merge in progress/);
    cleanup();
  });

  it('reports conflicted files from diff --diff-filter=U', async () => {
    const { repoRoot, gitDir, cleanup } = layoutGitDir();
    writeFileSync(join(gitDir, 'MERGE_HEAD'), 'abc\n');

    const cli = {
      resolveGitDirectories: async () => ({ gitDir, commonDir: gitDir }),
      execRead: async (args: string[]) => {
        if (args[0] === 'diff') {
          return { stdout: 'src/a.ts\nsrc/b.ts\n' };
        }
        return { stdout: '' };
      },
    } as unknown as GitCli;

    const svc = new RepoOperationService(
      mockGitExtensionService([mockRepository(repoRoot)]),
      mockCliRegistry(repoRoot, cli),
    );

    const status = await svc.getStatus(repoRoot);
    assert.equal(status.conflicted, true);
    assert.match(status.summary, /2 conflicted files/);
    cleanup();
  });

  it('detects rebase from rebase-merge directory', async () => {
    const { repoRoot, gitDir, cleanup } = layoutGitDir();
    mkdirSync(join(gitDir, 'rebase-merge'), { recursive: true });

    const cli = {
      resolveGitDirectories: async () => ({ gitDir, commonDir: gitDir }),
      execRead: async () => ({ stdout: '' }),
    } as unknown as GitCli;

    const svc = new RepoOperationService(
      mockGitExtensionService([mockRepository(repoRoot)]),
      mockCliRegistry(repoRoot, cli),
    );

    const status = await svc.getStatus(repoRoot);
    assert.equal(status.kind, 'rebase');
    cleanup();
  });

  it('detects bisect from BISECT_LOG', async () => {
    const { repoRoot, gitDir, cleanup } = layoutGitDir();
    writeFileSync(join(gitDir, 'BISECT_LOG'), 'bisect start\n');

    const cli = {
      resolveGitDirectories: async () => ({ gitDir, commonDir: gitDir }),
      execRead: async () => ({ stdout: '' }),
    } as unknown as GitCli;

    const svc = new RepoOperationService(
      mockGitExtensionService([mockRepository(repoRoot)]),
      mockCliRegistry(repoRoot, cli),
    );

    const status = await svc.getStatus(repoRoot);
    assert.equal(status.kind, 'bisect');
    assert.match(status.summary, /Bisect in progress/);
    cleanup();
  });
});
