import { strict as assert } from 'node:assert';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';

import { bindExtension, git, repoRoot, waitFor, type ChangeRow } from './harness';

describe('Changes tab', () => {
  const ctx = bindExtension();

  it('stages, commits with a subject and description, and unstages', async () => {
    writeFileSync(join(repoRoot(), 'work.txt'), 'work\n');
    writeFileSync(join(repoRoot(), 'other.txt'), 'other\n');

    await ctx.api.sendPanelMessage({ type: 'changesActions', actions: [{ op: 'stage', path: 'work.txt' }] });
    await waitFor('staged file', async () => (git('diff', '--cached', '--name-only') === 'work.txt' ? true : undefined));

    await ctx.api.sendPanelMessage({
      type: 'changesCommit',
      subject: 'Add work',
      description: 'Why it matters',
      amend: false,
    });
    await waitFor('commit', async () => (git('log', '-1', '--format=%s') === 'Add work' ? true : undefined));
    assert.equal(git('log', '-1', '--format=%b').trim(), 'Why it matters');
    assert.equal(git('show', '--name-only', '--format=', 'HEAD'), 'work.txt');

    await ctx.api.sendPanelMessage({ type: 'changesActions', actions: [{ op: 'stage', path: 'other.txt' }] });
    await waitFor('second staged file', async () => (git('diff', '--cached', '--name-only') === 'other.txt' ? true : undefined));
    await ctx.api.sendPanelMessage({ type: 'changesActions', actions: [{ op: 'unstage', path: 'other.txt' }] });
    await waitFor('unstaged again', async () => (git('diff', '--cached', '--name-only') === '' ? true : undefined));
  });

  it('does nothing with nothing staged', async () => {
    const before = git('rev-parse', 'HEAD');
    await ctx.api.sendPanelMessage({ type: 'changesCommit', subject: 'empty', description: '', amend: false });
    assert.equal(git('rev-parse', 'HEAD'), before);
  });

  it('runs the file menu commands on a change', async () => {
    writeFileSync(join(repoRoot(), 'menu.txt'), 'menu\n');
    const target = { webviewSection: 'changesFile', path: 'menu.txt', side: 'unstaged', untracked: true };
    await vscode.commands.executeCommand('gitCheckout.changes.stage', target);
    await waitFor('staged by menu', async () => (git('diff', '--cached', '--name-only') === 'menu.txt' ? true : undefined));
    await vscode.commands.executeCommand('gitCheckout.changes.unstage', { ...target, side: 'staged' });
    await waitFor('unstaged by menu', async () => (git('diff', '--cached', '--name-only') === '' ? true : undefined));

    await vscode.env.clipboard.writeText('');
    await vscode.commands.executeCommand('gitCheckout.changes.copyPath', target);
    assert.equal(await vscode.env.clipboard.readText(), 'menu.txt');

    await vscode.commands.executeCommand('gitCheckout.changes.open', target);
    await waitFor('working file editor', async () =>
      vscode.window.visibleTextEditors.find((entry) => entry.document.uri.fsPath === join(repoRoot(), 'menu.txt')),
    );
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  /** The rows a Changes list shows, as `path` for files and `folder/` for folders with their children indented. */
  async function rows(which: 'unstaged' | 'staged', nodes?: ChangeRow[], depth = 0): Promise<string[]> {
    const provider = ctx.api.changesLists[which];
    const level = nodes ?? ((await provider.getChildren()) as ChangeRow[]);
    const out: string[] = [];
    for (const node of level) {
      out.push(`${'  '.repeat(depth)}${node.kind === 'dir' ? `${node.label}/` : node.path}`);
      if (node.kind === 'dir') {
        out.push(...(await rows(which, (node.children ?? []), depth + 1)));
      }
    }
    return out;
  }

  /**
   * Re-reads the working copy now. The lists come from the built-in Git extension's state, which follows
   * files on disk with a delay of its own, so ask it to look first.
   */
  const refresh = async (): Promise<void> => {
    await vscode.commands.executeCommand('git.refresh');
    await ctx.api.sendPanelMessage({ type: 'changesReady' });
  };

  it('lists changes in the native Unstaged and Staged views and moves them between the two', async () => {
    writeFileSync(join(repoRoot(), 'one.txt'), '1\n');
    writeFileSync(join(repoRoot(), 'two.txt'), '2\n');
    let seen = '';
    await waitFor('both listed as unstaged', async () => {
      await refresh();
      seen = (await rows('unstaged')).join();
      return seen === 'one.txt,two.txt' ? true : undefined;
    }, 30_000, () => `unstaged rows: [${seen}] git: [${git('status', '--short')}] root: ${repoRoot()}`);
    assert.deepEqual(await rows('staged'), []);

    await vscode.commands.executeCommand('gitCheckout.changes.stage', { kind: 'file', path: 'one.txt', side: 'unstaged', untracked: true });
    await waitFor('one staged', async () =>
      (await rows('staged')).join() === 'one.txt' && (await rows('unstaged')).join() === 'two.txt' ? true : undefined,
    );

    const [item] = (await ctx.api.changesLists.unstaged.getChildren()) as ChangeRow[];
    const treeItem = await ctx.api.changesLists.unstaged.getTreeItem(item);
    assert.equal(treeItem.contextValue, 'change.file.unstaged');
    // A click runs the row's command, so a row that is already highlighted still shows its diff.
    assert.match(treeItem.command?.command ?? '', /\.internal\.pick\./);
    assert.equal(treeItem.command?.arguments?.[0], item);
    await vscode.commands.executeCommand(treeItem.command!.command, ...(treeItem.command!.arguments ?? []));
    assert.equal(treeItem.resourceUri?.path, '/two.txt');
  });

  it('shows folders in tree mode, and staging a folder stages everything in it', async () => {
    mkdirSync(join(repoRoot(), 'pkg/inner'), { recursive: true });
    writeFileSync(join(repoRoot(), 'pkg/a.txt'), 'a\n');
    writeFileSync(join(repoRoot(), 'pkg/inner/b.txt'), 'b\n');
    writeFileSync(join(repoRoot(), 'top.txt'), 't\n');
    await vscode.commands.executeCommand('gitCheckout.changes.viewAs.tree');
    try {
      const expected = ['pkg/', '  inner/', '    pkg/inner/b.txt', '  pkg/a.txt', 'top.txt'];
      await waitFor('folders listed', async () => {
        await refresh();
        return (await rows('unstaged')).join('|') === expected.join('|') ? true : undefined;
      });
      const [folder] = (await ctx.api.changesLists.unstaged.getChildren()) as ChangeRow[];
      await vscode.commands.executeCommand('gitCheckout.changes.stage', folder);
      await waitFor('folder staged', async () =>
        git('diff', '--cached', '--name-only').split('\n').sort().join() === 'pkg/a.txt,pkg/inner/b.txt' ? true : undefined,
      );
      assert.deepEqual(await rows('unstaged'), ['top.txt']);
    } finally {
      await vscode.commands.executeCommand('gitCheckout.changes.viewAs.list');
    }
  });

  it('does nothing when Stage or Unstage runs from the keyboard with nothing selected', async () => {
    writeFileSync(join(repoRoot(), 'idle.txt'), 'idle\n');
    // Enter in a list runs these with no row, so they act on the list's selection; with none, on nothing.
    await vscode.commands.executeCommand('gitCheckout.changes.stage');
    await vscode.commands.executeCommand('gitCheckout.changes.unstage');
    assert.equal(git('diff', '--cached', '--name-only'), '');
  });

  it('runs the file menu commands on every selected change', async () => {
    for (const name of ['m1.txt', 'm2.txt', 'm3.txt']) {
      writeFileSync(join(repoRoot(), name), `${name}\n`);
    }
    // A menu hands over the row it opened on, then the whole selection.
    const row = (name: string, side: 'unstaged' | 'staged' = 'unstaged') => ({ kind: 'file', path: name, side, untracked: true });
    const staged = () => git('diff', '--cached', '--name-only').split('\n').filter(Boolean).sort().join();

    await vscode.commands.executeCommand('gitCheckout.changes.stage', row('m1.txt'), [row('m1.txt'), row('m3.txt')]);
    await waitFor('both staged', async () => (staged() === 'm1.txt,m3.txt' ? true : undefined));

    await vscode.env.clipboard.writeText('');
    const both = [row('m1.txt', 'staged'), row('m3.txt', 'staged')];
    await vscode.commands.executeCommand('gitCheckout.changes.copyPath', both[0], both);
    assert.equal(await vscode.env.clipboard.readText(), 'm1.txt\nm3.txt');

    await vscode.commands.executeCommand('gitCheckout.changes.unstage', both[0], both);
    await waitFor('both unstaged', async () => (staged() === '' ? true : undefined));
  });

  it('keeps view title buttons visible instead of only on hover', () => {
    const setting = vscode.workspace.getConfiguration('workbench.view').inspect<boolean>('alwaysShowHeaderActions');
    assert.equal(setting?.defaultValue, true);
  });

  it('stages and unstages everything from the view title buttons', async () => {
    writeFileSync(join(repoRoot(), 'one.txt'), '1\n');
    writeFileSync(join(repoRoot(), 'two.txt'), '2\n');
    await vscode.commands.executeCommand('gitCheckout.changes.stageAll');
    await waitFor('everything staged', async () =>
      git('diff', '--cached', '--name-only').split('\n').sort().join() === 'one.txt,two.txt' ? true : undefined,
    );
    await vscode.commands.executeCommand('gitCheckout.changes.unstageAll');
    await waitFor('everything unstaged', async () => (git('diff', '--cached', '--name-only') === '' ? true : undefined));
  });

  it('stages and unstages one hunk from a patch of the diff on screen', async () => {
    const lines = Array.from({ length: 40 }, (_, i) => `line ${i}`);
    writeFileSync(join(repoRoot(), 'hunks.txt'), `${lines.join('\n')}\n`);
    git('add', 'hunks.txt');
    git('commit', '-m', 'hunks base');
    const edited = [...lines];
    edited[3] = 'first edit';
    edited[35] = 'second edit';
    writeFileSync(join(repoRoot(), 'hunks.txt'), `${edited.join('\n')}\n`);

    // The patch for the first hunk: git's file header, then that hunk only.
    const diff = git('diff', '-U3', '--', 'hunks.txt').split('\n');
    const firstHunk = diff.indexOf(diff.find((line) => line.startsWith('@@'))!);
    const secondHunk = diff.indexOf(diff.filter((line) => line.startsWith('@@'))[1]);
    const patch = `${[...diff.slice(0, firstHunk).filter((line) => !line.startsWith('index ')), ...diff.slice(firstHunk, secondHunk)].join('\n')}\n`;

    await ctx.api.sendPanelMessage({ type: 'changesHunk', path: 'hunks.txt', op: 'stage', patch });
    await waitFor('first hunk staged', async () =>
      git('diff', '--cached', '--', 'hunks.txt').includes('first edit') ? true : undefined,
    );
    assert.ok(!git('diff', '--cached', '--', 'hunks.txt').includes('second edit'));
    assert.ok(git('diff', '--', 'hunks.txt').includes('second edit'));

    await ctx.api.sendPanelMessage({ type: 'changesHunk', path: 'hunks.txt', op: 'unstage', patch });
    await waitFor('hunk unstaged', async () => (git('diff', '--cached', '--name-only') === '' ? true : undefined));
  });

  it('stages and unstages only the selected lines of a change', async () => {
    writeFileSync(join(repoRoot(), 'lines.txt'), 'a\nb\nc\n');
    git('add', 'lines.txt');
    git('commit', '-m', 'lines base');
    writeFileSync(join(repoRoot(), 'lines.txt'), 'a\nB\nc\n');

    // What the diff view sends for a selection of the added line alone: the removed line stays as context.
    const patch = 'diff --git a/lines.txt b/lines.txt\n--- a/lines.txt\n+++ b/lines.txt\n@@ -1,3 +1,4 @@\n a\n b\n+B\n c\n';
    await ctx.api.sendPanelMessage({ type: 'changesHunk', path: 'lines.txt', op: 'stage', patch });
    await waitFor('the added line staged', async () => (git('show', ':lines.txt') === 'a\nb\nB\nc' ? true : undefined));
    assert.ok(git('diff', '--', 'lines.txt').includes('-b'), 'the removal is still to stage');

    await ctx.api.sendPanelMessage({ type: 'changesHunk', path: 'lines.txt', op: 'unstage', patch });
    await waitFor('the added line unstaged', async () => (git('show', ':lines.txt') === 'a\nb\nc' ? true : undefined));
  });

  it('amends the last commit with a new message', async () => {
    writeFileSync(join(repoRoot(), 'amend.txt'), 'a\n');
    git('add', 'amend.txt');
    await ctx.api.sendPanelMessage({ type: 'changesCommit', subject: 'First wording', description: '', amend: false });
    await waitFor('commit', async () => (git('log', '-1', '--format=%s') === 'First wording' ? true : undefined));
    const before = git('rev-list', '--count', 'HEAD');

    await ctx.api.sendPanelMessage({ type: 'changesCommit', subject: 'Better wording', description: 'Details', amend: true });
    await waitFor('amended', async () => (git('log', '-1', '--format=%s') === 'Better wording' ? true : undefined));
    assert.equal(git('rev-list', '--count', 'HEAD'), before);
    assert.equal(git('log', '-1', '--format=%b').trim(), 'Details');
  });

  it('asks for a generated message without a language model and leaves the commit alone', async () => {
    writeFileSync(join(repoRoot(), 'ai.txt'), 'ai\n');
    git('add', 'ai.txt');
    const before = git('rev-parse', 'HEAD');
    // The test host has no model, so this must come back with a notice rather than hang or commit.
    await ctx.api.sendPanelMessage({ type: 'changesGenerateMessage' });
    assert.equal(git('rev-parse', 'HEAD'), before);
  });
});

