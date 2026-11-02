import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import * as vscode from 'vscode';

import { createFixtureRepo } from './fixtureRepo';
import { basename } from 'node:path';
import { bindExtension, resetToRepository, findByRef, git, loadTree, openTabSummary, PANEL_VIEW_TYPE, readyTree, repoRoot, updateWorkspaceFolders, waitFor, type SidebarNode } from './harness';

function gitIn(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

async function viewRows(provider: vscode.TreeDataProvider<SidebarNode>): Promise<SidebarNode[]> {
  return (await provider.getChildren()) ?? [];
}

/** The repositories the Repositories view lists, as folder names. */
async function listed(api: { repositories: vscode.TreeDataProvider<SidebarNode> }): Promise<string[]> {
  return (await viewRows(api.repositories)).map((row) => row.label);
}

/** What the removed repository menu did: pick the repository, then open its graph window. */
async function openWindowOf(api: { selectRepository(root: string): Promise<void> }, root: string): Promise<void> {
  await api.selectRepository(root);
  await vscode.commands.executeCommand('gitCheckout.open');
}

describe('Repositories view', () => {
  const ctx = bindExtension();

  /** Removes the second repository's folder and waits until the views no longer list it. */
  async function closeSecond(second: string): Promise<void> {
    const target = vscode.Uri.file(second).fsPath;
    const index = (vscode.workspace.workspaceFolders ?? []).findIndex((folder) => folder.uri.fsPath === target);
    if (index >= 0) {
      vscode.workspace.updateWorkspaceFolders(index, 1);
    }
    await waitFor('second repository closed', async () => ((await listed(ctx.api)).length === 1 ? true : undefined));
    await resetToRepository(ctx.api, repoRoot());
    rmSync(second, { recursive: true, force: true });
  }

  it('declares the Repositories view and a view for each section, and has no LFS or reflog view', async () => {
    await readyTree(ctx.api);
    const rows = await loadTree(ctx.api);
    assert.ok(rows.some((node) => node.id === 'section:branches'));
    assert.ok(rows.every((node) => node.kind !== 'message' || node.label.length > 0));
    assert.deepEqual(await listed(ctx.api), [basename(repoRoot())]);

    const views = Object.values(
      (ctx.extension.packageJSON.contributes.views ?? {}) as Record<string, { id: string }[]>,
    ).flat().map((view) => view.id);
    for (const id of ['gitCheckout.repositories', 'gitCheckout.commitForm', 'gitCheckout.changes', 'gitCheckout.sidebar', 'gitCheckout.sidebar.pullRequests']) {
      assert.ok(views.includes(id), id);
    }
    assert.deepEqual(views.filter((id) => /lfs|reflog/i.test(id)), []);
  });

  it('shows the graph of a repository when its row is clicked', async () => {
    await readyTree(ctx.api);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    const [row] = await viewRows(ctx.api.repositories);
    const item = await ctx.api.repositories.getTreeItem(row);
    assert.equal(item.command?.command, 'gitCheckout.sidebar.showAllCommits');
    await vscode.commands.executeCommand(item.command.command, ...(item.command.arguments ?? []));
    const open = await waitFor('the graph window', async () => vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .some((tab) => (tab.input as { viewType?: string } | undefined)?.viewType?.includes(PANEL_VIEW_TYPE)) || undefined);
    assert.ok(open);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  it('lists every repository, and shows the one that is picked in the other views', async () => {
    await readyTree(ctx.api);
    const second = createFixtureRepo();
    gitIn(second, 'branch', 'topic-b');
    const folders = vscode.workspace.workspaceFolders ?? [];
    await updateWorkspaceFolders(folders.length, 0, { uri: vscode.Uri.file(second) });
    try {
      await waitFor('both repositories listed', async () => ((await listed(ctx.api)).length === 2 ? true : undefined));
      assert.equal(findByRef(await loadTree(ctx.api), 'topic-b'), undefined, 'the first repository is shown');

      await ctx.api.selectRepository(second);
      const rows = await waitFor('the second repository in the views', async () => {
        const found = await loadTree(ctx.api);
        return findByRef(found, 'topic-b') ? found : undefined;
      });
      assert.ok(rows.every((row) => row.repoRoot !== undefined));

      const branch = findByRef(rows, 'topic-b');
      assert.ok(branch);
      await vscode.commands.executeCommand('gitCheckout.sidebar.checkout', branch);
      assert.equal(gitIn(second, 'branch', '--show-current'), 'topic-b');
      assert.equal(git('branch', '--show-current'), 'main');
    } finally {
      await closeSecond(second);
    }
  });

  it('runs a repository menu command on the repository whose row it came from', async () => {
    await readyTree(ctx.api);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    const second = createFixtureRepo();
    const folders = vscode.workspace.workspaceFolders ?? [];
    await updateWorkspaceFolders(folders.length, 0, { uri: vscode.Uri.file(second) });
    try {
      await waitFor('both repositories listed', async () => ((await listed(ctx.api)).length === 2 ? true : undefined));
      // Right-clicking the second repository's row runs the command on it, whichever repository is selected.
      const row = (await viewRows(ctx.api.repositories)).find((entry) => entry.repoRoot !== undefined && entry.label === basename(second));
      assert.ok(row);
      const pending = vscode.commands.executeCommand('gitCheckout.repo.newTag', row);
      const state = await waitFor('new tag form', async () => ctx.api.operationFormState());
      await ctx.api.sendPanelMessage({
        type: 'operationFormMessage', sessionId: state.sessionId,
        message: { type: 'formSubmit', values: { ...state.form.values, name: 'menu-tag', message: 'from the menu' } },
      });
      await pending;
      assert.equal(gitIn(second, 'tag', '--list', 'menu-tag'), 'menu-tag');
      assert.equal(git('tag', '--list', 'menu-tag'), '');
    } finally {
      const active = ctx.api.operationFormState();
      if (active) {
        await ctx.api.sendPanelMessage({
          type: 'operationFormMessage', sessionId: active.sessionId, message: { type: 'formCancel' },
        });
      }
      await closeSecond(second);
    }
  });

  it('opens one window per repository, each titled with its repository', async () => {
    await readyTree(ctx.api);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    const second = createFixtureRepo();
    const folders = vscode.workspace.workspaceFolders ?? [];
    await updateWorkspaceFolders(folders.length, 0, { uri: vscode.Uri.file(second) });
    const windowTitles = (): string[] => vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter((tab) => (tab.input as { viewType?: string } | undefined)?.viewType?.includes(PANEL_VIEW_TYPE))
      .map((tab) => tab.label);
    try {
      await waitFor('both repositories listed', async () => ((await listed(ctx.api)).length === 2 ? true : undefined));
      await openWindowOf(ctx.api, repoRoot());
      await openWindowOf(ctx.api, second);
      const titles = await waitFor('two graph windows', async () => {
        const found = windowTitles();
        return found.length === 2 ? found : undefined;
      }, 15_000, () => `open tabs: ${openTabSummary()}`);
      assert.ok(titles.some((title) => title.endsWith(basename(repoRoot()))), titles.join(', '));
      assert.ok(titles.some((title) => title.endsWith(basename(second))), titles.join(', '));
      // Opening a repository's window again brings that one forward instead of making another.
      await openWindowOf(ctx.api, second);
      assert.equal(windowTitles().length, 2);
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await closeSecond(second);
    }
  });

  it('keeps a form open in each repository window at the same time', async () => {
    await readyTree(ctx.api);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    const second = createFixtureRepo();
    const folders = vscode.workspace.workspaceFolders ?? [];
    await updateWorkspaceFolders(folders.length, 0, { uri: vscode.Uri.file(second) });
    const windowCount = (): number => vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter((tab) => (tab.input as { viewType?: string } | undefined)?.viewType?.includes(PANEL_VIEW_TYPE)).length;
    const cancel = async (): Promise<void> => {
      const open = ctx.api.operationFormState();
      if (open) {
        await ctx.api.sendPanelMessage({
          type: 'operationFormMessage', sessionId: open.sessionId, message: { type: 'formCancel' },
        });
      }
    };
    try {
      await waitFor('both repositories listed', async () => ((await listed(ctx.api)).length === 2 ? true : undefined));
      await ctx.api.selectRepository(repoRoot());
      const first = vscode.commands.executeCommand('gitCheckout.repo.newTag');
      await waitFor('first tag form', async () => ctx.api.operationFormState());
      await ctx.api.selectRepository(second);
      const other = vscode.commands.executeCommand('gitCheckout.repo.newTag');
      // Opening the other repository's form must not replace or refuse because the first is still open.
      await waitFor('second repository window', async () => (windowCount() === 2 ? true : undefined));
      await openWindowOf(ctx.api, repoRoot());
      assert.ok(ctx.api.operationFormState(), 'the first repository still has its form open');
      await cancel();
      await openWindowOf(ctx.api, second);
      assert.ok(ctx.api.operationFormState(), 'the second repository has its own form open');
      await cancel();
      await Promise.all([first, other]);
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await closeSecond(second);
    }
  });
});
