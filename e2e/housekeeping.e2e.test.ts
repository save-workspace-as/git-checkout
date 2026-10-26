import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';

import { bindExtension, git, readyTree, repoRoot } from './harness';
import { answer } from './graphMenu';

describe('Housekeeping', () => {
  const ctx = bindExtension();
  const restore: (() => void)[] = [];

  beforeEach(async () => {
    await readyTree(ctx.api);
  });

  afterEach(() => {
    while (restore.length > 0) { restore.pop()?.(); }
  });

  it('Delete Merged Branches…: deletes the chosen merged branches and leaves unmerged ones', async () => {
    git('branch', 'merged-one');
    git('checkout', '-b', 'unmerged-one');
    writeFileSync(join(repoRoot(), 'unmerged.txt'), 'x\n');
    git('add', 'unmerged.txt');
    git('commit', '-m', 'unmerged work');
    git('checkout', '-');
    let offered: string[] = [];
    restore.push(answer('showQuickPick', async (items: unknown) => {
      offered = (items as { label: string }[]).map((item) => item.label);
      return items;
    }));
    await vscode.commands.executeCommand('gitCheckout.deleteMergedBranches');
    assert.ok(offered.includes('merged-one'));
    assert.ok(!offered.includes('unmerged-one'));
    const branches = git('branch', '--format=%(refname:short)').split('\n');
    assert.ok(!branches.includes('merged-one'));
    assert.ok(branches.includes('unmerged-one'));
  });

  it('Clean Untracked Files…: deletes the chosen untracked files after a confirmation', async () => {
    writeFileSync(join(repoRoot(), 'scratch.txt'), 'x\n');
    mkdirSync(join(repoRoot(), 'build'));
    writeFileSync(join(repoRoot(), 'build', 'out.js'), 'x\n');
    const asked: unknown[] = [];
    restore.push(
      answer('showQuickPick', async (items: unknown) => {
        asked.push(items);
        const list = items as { label: string }[];
        // First the scope, then the files: keep only scratch.txt.
        return asked.length === 1 ? list[0] : list.filter((item) => item.label === 'scratch.txt');
      }),
      answer('showWarningMessage', async (_message: unknown, _options: unknown, ...actions: unknown[]) => actions[0]),
    );
    await vscode.commands.executeCommand('gitCheckout.cleanUntracked');
    assert.equal(existsSync(join(repoRoot(), 'scratch.txt')), false);
    assert.equal(existsSync(join(repoRoot(), 'build', 'out.js')), true);
  });

  it('Clean Untracked Files…: deletes nothing when the confirmation is declined', async () => {
    writeFileSync(join(repoRoot(), 'keep.txt'), 'x\n');
    let calls = 0;
    restore.push(
      answer('showQuickPick', async (items: unknown) => (calls++ === 0 ? (items as unknown[])[0] : items)),
      answer('showWarningMessage', async () => undefined),
    );
    await vscode.commands.executeCommand('gitCheckout.cleanUntracked');
    assert.equal(existsSync(join(repoRoot(), 'keep.txt')), true);
  });

  it('Run Garbage Collection: completes on a repository', async () => {
    await vscode.commands.executeCommand('gitCheckout.gc');
    assert.match(git('rev-parse', '--git-dir'), /\.git/);
  });

  it('Repository Statistics…: lists the counts and the contributors', async () => {
    let shown: { label: string; description?: string }[] = [];
    restore.push(answer('showQuickPick', async (items: unknown) => {
      shown = items as typeof shown;
      return undefined;
    }));
    await vscode.commands.executeCommand('gitCheckout.statistics');
    const labels = shown.map((item) => item.label);
    for (const label of ['Summary', 'Commits', 'Local branches', 'Tags', 'Contributors']) {
      assert.ok(labels.includes(label), label);
    }
    assert.equal(shown.find((item) => item.label === 'Commits')?.description, git('rev-list', '--count', 'HEAD'));
  });

  it('Sparse Checkout…: keeps only the chosen folders, and checks everything out again', async () => {
    for (const folder of ['keep', 'skip']) {
      mkdirSync(join(repoRoot(), folder));
      writeFileSync(join(repoRoot(), folder, 'file.txt'), folder);
    }
    git('add', '.');
    git('commit', '-m', 'folders');
    let step = 0;
    restore.push(answer('showQuickPick', async (items: unknown) => {
      const list = items as { label: string; action?: string }[];
      step++;
      return step === 1 ? list.find((item) => item.action === 'set') : list.filter((item) => item.label === 'keep');
    }));
    await vscode.commands.executeCommand('gitCheckout.sparseCheckout');
    assert.equal(existsSync(join(repoRoot(), 'skip', 'file.txt')), false);
    assert.equal(existsSync(join(repoRoot(), 'keep', 'file.txt')), true);

    restore.push(answer('showQuickPick', async (items: unknown) =>
      (items as { action?: string }[]).find((item) => item.action === 'disable')));
    await vscode.commands.executeCommand('gitCheckout.sparseCheckout');
    assert.equal(existsSync(join(repoRoot(), 'skip', 'file.txt')), true);
  });
});

