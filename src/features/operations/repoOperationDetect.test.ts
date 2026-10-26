import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { detectRepoOperationKind } from './repoOperationDetect';

function layoutGitDir(): { gitDir: string; cleanup: () => void } {
  const repoRoot = mkdtempSync(join(tmpdir(), 'git-checkout-detect-'));
  const gitDir = join(repoRoot, '.git');
  mkdirSync(gitDir, { recursive: true });
  return { gitDir, cleanup: () => rmSync(repoRoot, { recursive: true, force: true }) };
}

describe('detectRepoOperationKind', () => {
  it('detects merge, rebase, cherry-pick, revert, and bisect markers', () => {
    const cases: { file: string; kind: string }[] = [
      { file: 'MERGE_HEAD', kind: 'merge' },
      { file: 'CHERRY_PICK_HEAD', kind: 'cherry-pick' },
      { file: 'REVERT_HEAD', kind: 'revert' },
      { file: 'BISECT_LOG', kind: 'bisect' },
    ];
    for (const { file, kind } of cases) {
      const { gitDir, cleanup } = layoutGitDir();
      writeFileSync(join(gitDir, file), 'abc\n');
      assert.equal(detectRepoOperationKind(gitDir), kind);
      cleanup();
    }
  });

  it('detects rebase from rebase-merge and rebase-apply', () => {
    for (const marker of ['rebase-merge', 'rebase-apply']) {
      const { gitDir, cleanup } = layoutGitDir();
      mkdirSync(join(gitDir, marker), { recursive: true });
      assert.equal(detectRepoOperationKind(gitDir), 'rebase');
      cleanup();
    }
  });

  it('does not take the REBASE_HEAD Git leaves behind after a finished rebase for one in progress', () => {
    const { gitDir, cleanup } = layoutGitDir();
    try {
      writeFileSync(join(gitDir, 'REBASE_HEAD'), 'abc\n');
      assert.equal(detectRepoOperationKind(gitDir), null);
    } finally {
      cleanup();
    }
  });
});
