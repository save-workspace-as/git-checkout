import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { initTempRepository, runGit, runGitAllowFailure, seedDivergentFileConflict } from '../../core/testing/gitRepoHarness';
import { mockCliRegistry } from '../../core/testing/serviceTestUtils';
import { conflictsOf, editableText, fileText, paneRows, parseMergeDocument, unresolved, withSideTaken } from '../../shared/conflicts/mergeDocument';
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
      assert.equal(file.ours, 'base\non main\n', 'the whole file of the current side');
      assert.equal(file.theirs, 'base\non other\n', 'the whole file of the incoming side');
      const document = parseMergeDocument(file.text);
      assert.deepEqual(conflictsOf(document).map((conflict) => [conflict.incoming, conflict.current]), [[['on other'], ['on main']]]);

      const resolved = fileText(document, editableText(document, conflictsOf(document).map((conflict) => withSideTaken(withSideTaken(unresolved(conflict), 'incoming', true), 'current', true))));
      assert.equal(resolved, 'base\non other\non main\n');
      await service.resolve(repo.repoRoot, 'conflict.txt', resolved);

      assert.equal(readFileSync(path.join(repo.repoRoot, 'conflict.txt'), 'utf8'), resolved);
      assert.equal((await repo.cli.execRead(['ls-files', '-u'])).stdout.trim(), '', 'nothing is left unmerged');
      // Git asks an editor to confirm the merge message; a runner has no terminal for one, so keep the message as it is.
      await repo.cli.execWrite(['merge', '--continue'], { env: { GIT_EDITOR: 'true' } });
      assert.equal((await repo.cli.execRead(['rev-list', '--merges', '--count', 'HEAD'])).stdout.trim(), '1', 'the merge is committed');
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

  it('keeps one side whole for a binary file and for a file that one side deleted', async () => {
    const repo = initTempRepository();
    try {
      const write = (name: string, bytes: number[]): void => {
        writeFileSync(path.join(repo.repoRoot, name), Buffer.from(bytes));
        runGit(repo.repoRoot, ['add', name]);
      };
      write('image.bin', [0, 1, 2, 3]);
      write('gone.bin', [0, 1, 1, 1]);
      runGit(repo.repoRoot, ['commit', '-m', 'base']);
      runGit(repo.repoRoot, ['checkout', '-b', 'other']);
      write('image.bin', [0, 9, 9, 9]);
      write('gone.bin', [0, 2, 2, 2]);
      runGit(repo.repoRoot, ['commit', '-am', 'other']);
      runGit(repo.repoRoot, ['checkout', '-']);
      write('image.bin', [0, 7, 7, 7]);
      runGit(repo.repoRoot, ['rm', '-q', 'gone.bin']);
      runGit(repo.repoRoot, ['commit', '-am', 'main']);
      assert.notEqual(runGitAllowFailure(repo.repoRoot, ['merge', 'other', '--no-commit']), 0);
      const service = new MergeResolverService(mockCliRegistry(repo.repoRoot, repo.cli));

      const gone = await service.load(repo.repoRoot, 'gone.bin');
      assert.deepEqual([gone.currentExists, gone.incomingExists], [false, true], 'the current side deleted it');
      assert.equal(conflictsOf(parseMergeDocument(gone.text)).length, 0, 'there are no markers to merge');

      await service.takeSide(repo.repoRoot, 'gone.bin', 'current');
      assert.equal(existsSync(path.join(repo.repoRoot, 'gone.bin')), false, 'keeping the side that deleted it deletes the file');
      await service.takeSide(repo.repoRoot, 'image.bin', 'incoming');
      assert.deepEqual([...readFileSync(path.join(repo.repoRoot, 'image.bin'))], [0, 9, 9, 9]);
      assert.equal((await repo.cli.execRead(['ls-files', '-u'])).stdout.trim(), '', 'nothing is left unmerged');
    } finally {
      runGitAllowFailure(repo.repoRoot, ['merge', '--abort']);
      repo.cleanup();
    }
  });

  it('gives the whole file of each side, so every line of both files is on a row of the panes', async () => {
    const repo = initTempRepository();
    try {
      const numbered = (edit: Record<number, string>): string =>
        `${Array.from({ length: 20 }, (_, i) => edit[i + 1] ?? `line ${i + 1}`).join('\n')}\n`;
      const put = (text: string): void => writeFileSync(path.join(repo.repoRoot, 'long.txt'), text);
      put(numbered({}));
      runGit(repo.repoRoot, ['add', 'long.txt']);
      runGit(repo.repoRoot, ['commit', '-m', 'base']);
      runGit(repo.repoRoot, ['checkout', '-b', 'other']);
      put(numbered({ 10: 'theirs ten', 18: 'theirs eighteen' }));
      runGit(repo.repoRoot, ['commit', '-am', 'other']);
      runGit(repo.repoRoot, ['checkout', '-']);
      put(numbered({ 3: 'ours three', 10: 'ours ten' }));
      runGit(repo.repoRoot, ['commit', '-am', 'main']);
      assert.notEqual(runGitAllowFailure(repo.repoRoot, ['merge', 'other', '--no-commit']), 0);
      const service = new MergeResolverService(mockCliRegistry(repo.repoRoot, repo.cli));

      const file = await service.load(repo.repoRoot, 'long.txt');
      const sides = { ours: file.ours!.trimEnd().split('\n'), theirs: file.theirs!.trimEnd().split('\n') };
      const rows = paneRows(parseMergeDocument(file.text), sides);
      assert.deepEqual(rows.flatMap((row) => (row.right ? [row.right.text] : [])), sides.ours);
      assert.deepEqual(rows.flatMap((row) => (row.left ? [row.left.text] : [])), sides.theirs);
      assert.deepEqual(
        rows.filter((row) => row.right?.changed || row.left?.changed).flatMap((row) => [row.left?.text, row.right?.text]).filter(Boolean),
        ['ours three', 'line 3', 'theirs ten', 'ours ten', 'theirs eighteen', 'line 18'],
        'the clean changes of each side, and the conflict, are colored',
      );
    } finally {
      runGitAllowFailure(repo.repoRoot, ['merge', '--abort']);
      repo.cleanup();
    }
  });
});
