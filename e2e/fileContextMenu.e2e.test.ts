import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';

import { bindExtension, git, repoRoot, waitFor } from './harness';

function context(path: string, revision: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    webviewSection: 'commitTree',
    commitTreeKind: 'blob',
    path,
    revision,
    preventDefaultContextMenuItems: true,
    ...extra,
  };
}

describe('File list context menu', () => {
  const ctx = bindExtension();
  const bindApi = () => ctx.api;

  let first: string;
  let second: string;

  beforeEach(() => {
    writeFileSync(join(repoRoot(), 'menu.txt'), 'first\n');
    git('add', 'menu.txt');
    git('commit', '-m', 'first');
    first = git('rev-parse', 'HEAD');
    writeFileSync(join(repoRoot(), 'menu.txt'), 'second\n');
    git('add', 'menu.txt');
    git('commit', '-m', 'second');
    second = git('rev-parse', 'HEAD');
  });

  afterEach(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  it('copies the repository path of the file', async () => {
    await vscode.env.clipboard.writeText('');
    await vscode.commands.executeCommand('gitCheckout.file.copyPath', context('menu.txt', second));
    assert.equal(await vscode.env.clipboard.readText(), 'menu.txt');
  });

  it('opens a file at its revision from the Tree list', async () => {
    await vscode.commands.executeCommand('gitCheckout.file.open', context('menu.txt', first));
    const editor = await waitFor('revision editor', async () =>
      vscode.window.visibleTextEditors.find(
        (entry) => entry.document.uri.scheme === 'git-checkout' && entry.document.getText() === 'first\n',
      ),
    );
    assert.ok(editor);
  });

  it('opens the exact revision from the Changes list, and a diff on request', async () => {
    await vscode.commands.executeCommand(
      'gitCheckout.file.open',
      context('menu.txt', first, { list: 'changes', status: 'M' }),
    );
    await waitFor('revision editor', async () =>
      vscode.window.visibleTextEditors.find(
        (entry) => entry.document.uri.scheme === 'git-checkout' && entry.document.getText() === 'first\n',
      ),
    );
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');

    await vscode.commands.executeCommand(
      'gitCheckout.file.openDiff',
      context('menu.txt', second, { list: 'changes', status: 'M' }),
    );
    const input = await waitFor('diff tab', async () =>
      vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .map((tab) => tab.input)
        .find((entry): entry is vscode.TabInputTextDiff => entry instanceof vscode.TabInputTextDiff),
    );
    assert.equal((await vscode.workspace.openTextDocument(input.original)).getText(), 'first\n');
    assert.equal((await vscode.workspace.openTextDocument(input.modified)).getText(), 'second\n');

  });

  it('opens the diff from the Commit list and the file at that commit from the Tree list', async () => {
    const api = bindApi();
    await api.sendPanelMessage({ type: 'commitFileOpen', sha: second, path: 'menu.txt', status: 'M' });
    const input = await waitFor('commit-list diff', async () =>
      vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .map((tab) => tab.input)
        .find((entry): entry is vscode.TabInputTextDiff => entry instanceof vscode.TabInputTextDiff),
    );
    assert.equal((await vscode.workspace.openTextDocument(input.original)).getText(), 'first\n');
    assert.equal((await vscode.workspace.openTextDocument(input.modified)).getText(), 'second\n');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await api.sendPanelMessage({ type: 'commitTreeSetRevision', revision: first });
    await api.sendPanelMessage({ type: 'commitTreeOpenInEditor', revision: first, path: 'menu.txt' });
    await waitFor('tree editor', async () =>
      vscode.window.visibleTextEditors.find(
        (entry) => entry.document.uri.scheme === 'git-checkout' && entry.document.getText() === 'first\n',
      ),
    );
    const tab = vscode.window.tabGroups.all.flatMap((group) => group.tabs).find((entry) => entry.isActive);
    assert.equal(tab?.label, `menu.txt @ ${first.slice(0, 7)}`);
  });

  it('opens a deleted file at the version before its deletion', async () => {
    git('rm', 'menu.txt');
    git('commit', '-m', 'delete');
    const deleted = git('rev-parse', 'HEAD');
    await vscode.commands.executeCommand(
      'gitCheckout.file.open',
      context('menu.txt', deleted, { list: 'changes', status: 'D' }),
    );
    await waitFor('editor of the last version', async () =>
      vscode.window.visibleTextEditors.find(
        (entry) => entry.document.uri.scheme === 'git-checkout' && entry.document.getText() === 'second\n',
      ),
    );
  });

  it('shows file history in the Git Checkout panel', async () => {
    await vscode.commands.executeCommand('gitCheckout.file.history', context('menu.txt', second));
    await waitFor('Git Checkout panel', async () =>
      vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .find((tab) => tab.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith('gitCheckout.main'))
        ? true
        : undefined,
    );
  });

  it('shows blame in the Git Checkout panel', async () => {
    await vscode.commands.executeCommand('gitCheckout.file.blame', context('menu.txt', second));
    await waitFor('Git Checkout panel', async () =>
      vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .find((tab) => tab.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith('gitCheckout.main'))
        ? true
        : undefined,
    );
  });

  it('ignores a folder or a missing revision', async () => {
    await vscode.commands.executeCommand('gitCheckout.file.copyPath', { ...context('menu.txt', second), commitTreeKind: 'tree' });
    await vscode.commands.executeCommand('gitCheckout.file.copyPath', { path: 'menu.txt' });
  });
});
