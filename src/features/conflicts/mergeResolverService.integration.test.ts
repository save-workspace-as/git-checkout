import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { initTempRepository, runGit, runGitAllowFailure, seedDivergentFileConflict } from '../../core/testing/gitRepoHarness';
import { mockCliRegistry } from '../../core/testing/serviceTestUtils';
import { conflictsOf, editableText, fileText, parseMergeDocument, unresolved, withSideTaken } from '../../shared/conflicts/mergeDocument';
import { MergeResolverService } from './mergeResolverService';

describe('MergeResolverService integration', () => {
  it('reads the conflicted file with both sides named, and resolves it by writing and staging', async () => {
    const repo = initTempRepository();
    try {
      seedDivergentFileConflict(repo);
      assert.notEqual(runGitAllowFailure(repo.repoRoot, ['merge', 'other', '--no-commit']), 0);
      const service = new MergeResolverService(mockCliRegistry(repo.repoRoot, repo.cli));

      const file = await service.load(repo.repoRoot, 'conflict.txt');
      assert.equal(file.current.label, 'main');
      assert.equal(file.current.subject, 'main');
      assert.equal(file.incoming.label, 'other');
      assert.equal(file.incoming.subject, 'other');
      assert.ok(file.incoming.date > 0 && file.incoming.author.length > 0);
      const document = parseMergeDocument(file.text);
      assert.deepEqual(conflictsOf(document).map((conflict) => [conflict.incoming, conflict.current]), [[['on other'], ['on main']]]);

      const resolved = fileText(document, editableText(document, conflictsOf(document).map((conflict) => withSideTaken(withSideTaken(unresolved(conflict), 'incoming', true), 'current', true))));
      assert.equal(resolved, 'base\non other\non main\n');
      await service.resolve(repo.repoRoot, 'conflict.txt', resolved);

      assert.equal(readFileSync(path.join(repo.repoRoot, 'conflict.txt'), 'utf8'), resolved);
      assert.equal((await repo.cli.execRead(['ls-files', '-u'])).stdout.trim(), '', 'nothing is left unmerged');
      assert.equal(runGitAllowFailure(repo.repoRoot, ['merge', '--continue']), 0);
    } finally {
      runGitAllowFailure(repo.repoRoot, ['merge', '--abort']);
      repo.cleanup();
    }
  });

  it('names the commit a cherry-pick brings by its branch, or by its hash when no branch has it', async () => {
    const repo = initTempRepository();
    try {
      seedDivergentFileConflict(repo);
      const service = new MergeResolverService(mockCliRegistry(repo.repoRoot, repo.cli));
      assert.notEqual(runGitAllowFailure(repo.repoRoot, ['cherry-pick', 'other']), 0);
      const named = await service.load(repo.repoRoot, 'conflict.txt');
      assert.equal(named.incoming.label, 'other');
      assert.equal(named.current.label, 'main');
      runGit(repo.repoRoot, ['cherry-pick', '--abort']);

      runGit(repo.repoRoot, ['checkout', '-q', '--detach', 'other']);
      writeFileSync(path.join(repo.repoRoot, 'conflict.txt'), 'base\nnobody has this\n');
      runGit(repo.repoRoot, ['commit', '-qam', 'unnamed']);
      const unnamed = (await repo.cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();
      runGit(repo.repoRoot, ['checkout', '-q', 'main']);
      assert.notEqual(runGitAllowFailure(repo.repoRoot, ['cherry-pick', unnamed]), 0);
      const byHash = await service.load(repo.repoRoot, 'conflict.txt');
      assert.equal(byHash.incoming.label, unnamed.slice(0, 7));
      assert.equal(byHash.incoming.subject, 'unnamed');
    } finally {
      runGitAllowFailure(repo.repoRoot, ['cherry-pick', '--abort']);
      repo.cleanup();
    }
  });

  it('refuses a path outside the repository', async () => {
    const repo = initTempRepository();
    try {
      const service = new MergeResolverService(mockCliRegistry(repo.repoRoot, repo.cli));
      await assert.rejects(() => service.load(repo.repoRoot, '../outside.txt'));
      await assert.rejects(() => service.resolve(repo.repoRoot, '../outside.txt', 'x'));
    } finally {
      repo.cleanup();
    }
  });
});
