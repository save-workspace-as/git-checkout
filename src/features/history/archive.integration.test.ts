import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { initTempRepository, runGit } from '../../core/testing/gitRepoHarness';
import { archiveArgs } from './archive';

describe('git archive', () => {
  for (const extension of ['zip', 'tar.gz', 'tar']) {
    it(`writes a .${extension} of a commit with the arguments the extension builds`, async () => {
      const repo = initTempRepository();
      const out = mkdtempSync(join(tmpdir(), 'git-checkout-archive-'));
      try {
        writeFileSync(join(repo.repoRoot, 'a.txt'), 'a\n');
        runGit(repo.repoRoot, ['add', 'a.txt']);
        runGit(repo.repoRoot, ['commit', '-m', 'a']);
        const file = join(out, `snapshot.${extension}`);
        await repo.cli.execWrite(archiveArgs('HEAD', file, 'repo'));
        assert.ok(statSync(file).size > 0);
      } finally {
        repo.cleanup();
        rmSync(out, { recursive: true, force: true });
      }
    });
  }
});
