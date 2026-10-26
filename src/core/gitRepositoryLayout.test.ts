import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import type { GitCli } from './gitCli';
import { resolveRepositoryLayout } from './gitRepositoryLayout';

function tempRepo(withReftable: boolean): { repoRoot: string; gitDir: string; commonDir: string } {
  const repoRoot = mkdtempSync(join(tmpdir(), 'git-checkout-layout-'));
  const gitDir = join(repoRoot, '.git');
  const commonDir = gitDir;
  mkdirSync(commonDir, { recursive: true });
  if (withReftable) {
    mkdirSync(join(commonDir, 'reftable'), { recursive: true });
  }
  return { repoRoot, gitDir, commonDir };
}

describe('resolveRepositoryLayout', () => {
  it('maps git directories and omits reftable when absent', async () => {
    const { repoRoot, gitDir, commonDir } = tempRepo(false);
    const cli = {
      resolveGitDirectories: async () => ({ gitDir, commonDir }),
    } as unknown as GitCli;

    const layout = await resolveRepositoryLayout(cli, repoRoot);
    assert.equal(layout.repoRoot, repoRoot);
    assert.equal(layout.gitDir, gitDir);
    assert.equal(layout.commonDir, commonDir);
    assert.equal(layout.reftableDir, null);
    assert.equal(layout.headPath, join(gitDir, 'HEAD'));
    assert.equal(layout.refsDir, join(commonDir, 'refs'));

    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('sets reftableDir when the reftable folder exists', async () => {
    const { repoRoot, gitDir, commonDir } = tempRepo(true);
    const cli = {
      resolveGitDirectories: async () => ({ gitDir, commonDir }),
    } as unknown as GitCli;

    const layout = await resolveRepositoryLayout(cli, repoRoot);
    assert.equal(layout.reftableDir, join(commonDir, 'reftable'));

    rmSync(repoRoot, { recursive: true, force: true });
  });
});
