import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';

import { answer } from './graphMenu';
import { createFixtureRepo, isSentinelFolder } from './fixtureRepo';
import { bindExtension, git, readyTree, repoRoot, updateWorkspaceFolders, waitFor } from './harness';

/** Puts `folder` where the fixture repository was, which is how a test chooses what the workspace holds. */
async function replaceFixtureFolder(folder: string): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const index = folders.findIndex((entry) => !isSentinelFolder(entry.uri.fsPath));
  assert.ok(index >= 0, 'e2e fixture folder is missing');
  await updateWorkspaceFolders(index, 1, { uri: vscode.Uri.file(folder) });
}

describe('Workspace shapes', () => {
  const ctx = bindExtension();
  const cleanup: (() => void)[] = [];

  afterEach(async () => {
    // VS Code opens a terminal in each folder these tests swap in; one still starting when its folder is
    // deleted reports "starting directory does not exist", so they go first.
    for (const terminal of vscode.window.terminals) { terminal.dispose(); }
    for (const undo of cleanup.splice(0).reverse()) { undo(); }
    // The window these tests open would otherwise count as a second one in the tests that follow.
    await vscode.window.tabGroups.close(vscode.window.tabGroups.all.flatMap((group) => group.tabs));
    await waitFor('the editors to close', async () =>
      vscode.window.tabGroups.all.every((group) => group.tabs.length === 0) ? true : undefined,
    );
  });

  const tempDir = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'git-checkout-e2e-shape-'));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
  };

  describe('a workspace with no Git repository', () => {
    beforeEach(async () => {
      await readyTree(ctx.api);
      await replaceFixtureFolder(tempDir());
      await waitFor('no repository', async () => ((await ctx.api.panelState()).repositories.length === 0 ? true : undefined));
    });

    it('says there is no repository, and lists nothing in the sidebar', async () => {
      const state = await ctx.api.panelState();
      assert.equal(state.empty, true);
      assert.equal(state.emptyReason, 'noRepository');
      assert.deepEqual(await ctx.api.sidebar.getChildren(), []);
    });

    it('opens the window without failing, and leaves every command that works on a repository harmless', async () => {
      const warnings: string[] = [];
      cleanup.push(
        answer('showWarningMessage', async (message: unknown) => { warnings.push(String(message)); return undefined; }),
        answer('showInformationMessage', async () => undefined),
        answer('showErrorMessage', async (message: unknown) => { warnings.push(`error: ${String(message)}`); return undefined; }),
        answer('showQuickPick', async () => undefined),
        answer('showInputBox', async () => undefined),
      );
      await vscode.commands.executeCommand('gitCheckout.open');

      const palette = new Set<string>(
        (ctx.extension.packageJSON.contributes.menus.commandPalette as { command: string; when?: string }[])
          .filter((entry) => entry.when === 'false')
          .map((entry) => entry.command),
      );
      const commands = (ctx.extension.packageJSON.contributes.commands as { command: string }[])
        .map((entry) => entry.command)
        .filter((id) => !palette.has(id));
      assert.ok(commands.length > 20, `expected the palette commands, got ${commands.length}`);

      const failures: string[] = [];
      for (const id of commands) {
        try {
          await Promise.race([
            vscode.commands.executeCommand(id),
            new Promise((_, reject) => setTimeout(() => reject(new Error('did not finish in 10s')), 10_000)),
          ]);
        } catch (error) {
          failures.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      assert.deepEqual(failures, []);
      assert.equal(warnings.filter((message) => message.startsWith('error:')).length, 0, warnings.join('\n'));
    });
  });

  describe('a folder that holds more than one repository', () => {
    it('shows each repository in its own sidebar view', async () => {
      await readyTree(ctx.api);
      const parent = tempDir();
      const names = ['alpha', 'beta'];
      for (const name of names) {
        const repo = join(parent, name);
        mkdirSync(repo);
        execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
        execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: repo });
        execFileSync('git', ['branch', `on-${name}`], { cwd: repo });
      }
      await replaceFixtureFolder(parent);
      // vscode.git finds repositories inside a folder when the window opens, not when a folder is added to
      // it; opening them by path gives the same result as that scan would have.
      for (const name of names) {
        await vscode.commands.executeCommand('git.openRepository', join(parent, name));
      }

      const roots = await waitFor('both repositories', async () => {
        const found = (await ctx.api.panelState()).repositories;
        return found.length === 2 ? found : undefined;
      });
      assert.deepEqual(roots.map((root) => root.split('/').pop()).sort(), names);
      for (const [index, name] of names.entries()) {
        const rows = await waitFor(`sidebar view ${index + 1}`, async () => {
          const found = (await ctx.api.sidebars[index]?.getChildren()) ?? [];
          return found.length > 0 ? found : undefined;
        });
        const labels = JSON.stringify(rows);
        assert.ok(names.some((candidate) => labels.includes(`on-${candidate}`)), `view ${index + 1} lists a repository branch`);
        assert.ok(rows.every((row) => row.repoRoot !== undefined && names.some((n) => row.repoRoot?.endsWith(`/${n}`))), name);
      }
    });
  });

  describe('when the repository the window shows leaves the workspace', () => {
    it('falls back to the repository that is left, and shows nothing once none is left', async () => {
      await readyTree(ctx.api);
      const first = repoRoot();
      const second = createFixtureRepo();
      cleanup.push(() => rmSync(second, { recursive: true, force: true }));
      const folders = vscode.workspace.workspaceFolders ?? [];
      await updateWorkspaceFolders(folders.length, 0, { uri: vscode.Uri.file(second) });
      await waitFor('both repositories', async () => ((await ctx.api.panelState()).repositories.length === 2 ? true : undefined));
      await ctx.api.selectRepository(second);
      await vscode.commands.executeCommand('gitCheckout.open');

      const secondIndex = (vscode.workspace.workspaceFolders ?? []).findIndex((entry) => entry.uri.fsPath === vscode.Uri.file(second).fsPath);
      await updateWorkspaceFolders(secondIndex, 1);
      await waitFor('one repository', async () => ((await ctx.api.panelState()).repositories.length === 1 ? true : undefined));
      // Commands that act on "the" repository now act on the one that is left.
      await vscode.commands.executeCommand('gitCheckout.copyActiveRepoPath');
      assert.equal(await vscode.env.clipboard.readText(), vscode.Uri.file(first).fsPath);
      assert.equal(git('branch', '--show-current'), 'main');
      assert.equal((await ctx.api.panelState()).empty, false);

      // The window of the repository that left has nothing to show: opening Git Checkout, even after picking the
      // repository that is left, gives one window and not a second one for the same repository.
      await vscode.window.tabGroups.close(vscode.window.tabGroups.all.flatMap((group) => group.tabs));
      await vscode.commands.executeCommand('gitCheckout.open');
      await ctx.api.selectRepository(first);
      await vscode.commands.executeCommand('gitCheckout.open');
      const webviewTabs = (): string[] =>
        vscode.window.tabGroups.all.flatMap((group) => group.tabs).filter((tab) => tab.input instanceof vscode.TabInputWebview).map((tab) => tab.label);
      await waitFor('the window', async () => (webviewTabs().length > 0 ? true : undefined));
      await new Promise((resolve) => setTimeout(resolve, 500));
      assert.deepEqual(webviewTabs(), ['Git Checkout']);

      await waitFor('no repository left', async () => {
        const state = await ctx.api.panelState();
        // vscode.git keeps a repository that was picked in a view after its folder is gone; close it, as the
        // harness does between tests.
        for (const root of state.repositories) {
          await vscode.commands.executeCommand('git.close', vscode.Uri.file(root));
        }
        return state.empty && state.emptyReason === 'noRepository' ? true : undefined;
      });
      assert.equal(await ctx.api.operationBanner(), undefined);
    });
  });
});
