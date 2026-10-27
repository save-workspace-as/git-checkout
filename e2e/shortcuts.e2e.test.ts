import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';

import { assertCommands, bindExtension, git, readyTree, repoRoot, waitFor, waitForGitCheckoutPanel } from './harness';

function gitIn(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'protocol.file.allow=always', ...args], { cwd, encoding: 'utf8' }).trim();
}

/** A bare remote with `main` pushed and tracked, and a second clone to push new work from. */
function withRemote(): { remote: string; other: string } {
  const remote = mkdtempSync(join(tmpdir(), 'git-checkout-e2e-remote-'));
  const other = mkdtempSync(join(tmpdir(), 'git-checkout-e2e-other-'));
  gitIn(remote, 'init', '--bare', '-b', 'main');
  git('remote', 'add', 'origin', remote);
  git('push', '-u', 'origin', 'main');
  gitIn(other, 'clone', remote, '.');
  gitIn(other, 'config', 'user.name', 'git-checkout-e2e');
  gitIn(other, 'config', 'user.email', 'e2e@git-checkout.local');
  return { remote, other };
}

describe('Keyboard shortcuts', () => {
  const ctx = bindExtension();

  afterEach(async () => {
    await vscode.window.tabGroups.close(vscode.window.tabGroups.all.flatMap((group) => group.tabs));
  });

  it('are bound to commands that exist, so each key does something', async () => {
    const bindings = ctx.extension.packageJSON.contributes.keybindings as { command: string }[];
    assert.ok(bindings.length >= 40);
    // The `git.*` ones belong to VS Code's own Git extension, which is not listed while no repository is open.
    const ours = bindings.map((entry) => entry.command).filter((command) => command.startsWith('gitCheckout.'));
    await assertCommands(ctx.extension, [...new Set(ours)]);
  });

  it('refresh and reveal HEAD run in an open window without failing', async () => {
    await readyTree(ctx.api);
    await vscode.commands.executeCommand('gitCheckout.open');
    await waitForGitCheckoutPanel();
    await vscode.commands.executeCommand('gitCheckout.refresh');
    await vscode.commands.executeCommand('gitCheckout.graph.revealHead');
  });

  it('can be changed in the Keyboard Shortcuts editor, which opens from a command', async () => {
    await vscode.commands.executeCommand('gitCheckout.openKeyboardShortcuts');
    await waitFor('the Keyboard Shortcuts editor', async () =>
      vscode.window.tabGroups.all.flatMap((group) => group.tabs).some((tab) => /Keyboard Shortcuts/i.test(tab.label)) ? true : undefined,
    );
  });

  it('Quick Stash stashes the working tree without asking', async () => {
    await readyTree(ctx.api);
    writeFileSync(join(repoRoot(), 'stashed.txt'), 'one\n');
    git('add', 'stashed.txt');
    git('commit', '-m', 'stashed');
    writeFileSync(join(repoRoot(), 'stashed.txt'), 'two\n');
    await vscode.commands.executeCommand('gitCheckout.quickStash');
    await waitFor('the stash entry', async () => (git('stash', 'list') !== '' ? true : undefined));
    assert.equal(git('status', '--porcelain'), '');
  });

  it('Quick Fetch, Quick Pull and Quick Push use the tracked remote without a form', async () => {
    await readyTree(ctx.api);
    const { remote, other } = withRemote();
    writeFileSync(join(other, 'theirs.txt'), 'theirs\n');
    gitIn(other, 'add', 'theirs.txt');
    gitIn(other, 'commit', '-m', 'theirs');
    gitIn(other, 'push', 'origin', 'main');

    await vscode.commands.executeCommand('gitCheckout.quickFetch');
    await waitFor('the fetched commit', async () => (git('log', '-1', '--format=%s', 'origin/main') === 'theirs' ? true : undefined));

    await vscode.commands.executeCommand('gitCheckout.quickPull');
    await waitFor('the pulled commit', async () => (git('log', '-1', '--format=%s') === 'theirs' ? true : undefined));

    writeFileSync(join(repoRoot(), 'mine.txt'), 'mine\n');
    git('add', 'mine.txt');
    git('commit', '-m', 'mine');
    await vscode.commands.executeCommand('gitCheckout.quickPush');
    await waitFor('the pushed commit', async () => (gitIn(remote, 'log', '-1', '--format=%s', 'main') === 'mine' ? true : undefined));
    assert.equal(ctx.api.operationFormState(), undefined, 'no form opened');
  });

  it('commits and pushes in one step from the Changes form', async () => {
    await readyTree(ctx.api);
    const { remote } = withRemote();
    writeFileSync(join(repoRoot(), 'both.txt'), 'both\n');
    await ctx.api.sendPanelMessage({ type: 'changesActions', actions: [{ op: 'stage', path: 'both.txt' }] });
    await waitFor('staged file', async () => (git('diff', '--cached', '--name-only') === 'both.txt' ? true : undefined));
    await ctx.api.sendPanelMessage({ type: 'changesCommit', subject: 'Commit-and-push', description: '', amend: false, push: true });
    await waitFor('the pushed commit', async () => (gitIn(remote, 'log', '-1', '--format=%s', 'main') === 'Commit-and-push' ? true : undefined));
  });

  it('Commit and push… commits, then opens the Push form without pushing', async () => {
    await readyTree(ctx.api);
    const { remote } = withRemote();
    const before = gitIn(remote, 'rev-parse', 'main');
    writeFileSync(join(repoRoot(), 'form.txt'), 'form\n');
    await ctx.api.sendPanelMessage({ type: 'changesActions', actions: [{ op: 'stage', path: 'form.txt' }] });
    await waitFor('staged file', async () => (git('diff', '--cached', '--name-only') === 'form.txt' ? true : undefined));
    // The message is handled until the Push form closes, so it is awaited after the form is canceled.
    const handled = ctx.api.sendPanelMessage({ type: 'changesCommit', subject: 'Push-form', description: '', amend: false, pushForm: true });
    const form = await waitFor('the Push form', async () => ctx.api.operationFormState());
    assert.equal(form.form.title, 'Push');
    assert.equal(git('log', '-1', '--format=%s'), 'Push-form');
    assert.equal(gitIn(remote, 'rev-parse', 'main'), before);
    await ctx.api.sendPanelMessage({
      type: 'operationFormMessage', sessionId: form.sessionId, message: { type: 'formCancel' },
    });
    await handled;
  });

  it('a commit alone does not push', async () => {
    await readyTree(ctx.api);
    const { remote } = withRemote();
    const before = gitIn(remote, 'rev-parse', 'main');
    writeFileSync(join(repoRoot(), 'local.txt'), 'local\n');
    await ctx.api.sendPanelMessage({ type: 'changesActions', actions: [{ op: 'stage', path: 'local.txt' }] });
    await waitFor('staged file', async () => (git('diff', '--cached', '--name-only') === 'local.txt' ? true : undefined));
    await ctx.api.sendPanelMessage({ type: 'changesCommit', subject: 'Local-only', description: '', amend: false });
    await waitFor('commit', async () => (git('log', '-1', '--format=%s') === 'Local-only' ? true : undefined));
    assert.equal(gitIn(remote, 'rev-parse', 'main'), before);
  });

  it('Filter by Active Branch switches the repository setting on and off', async () => {
    await readyTree(ctx.api);
    await vscode.commands.executeCommand('gitCheckout.open');
    await waitForGitCheckoutPanel();
    const value = (): string => {
      try {
        return git('config', '--local', '--get', 'gitcheckout.graph.activeBranchOnly');
      } catch {
        return '';
      }
    };
    await vscode.commands.executeCommand('gitCheckout.graph.toggleActiveBranchOnly');
    await waitFor('the setting on', async () => (value() === 'true' ? true : undefined));
    await vscode.commands.executeCommand('gitCheckout.graph.toggleActiveBranchOnly');
    await waitFor('the setting off', async () => (value() === 'false' ? true : undefined));
  });

  it('filters by the active branch from the menu and leaves it from the graph banner', async () => {
    await readyTree(ctx.api);
    await vscode.commands.executeCommand('gitCheckout.open');
    await waitForGitCheckoutPanel();
    const value = (): string => {
      try {
        return git('config', '--local', '--get', 'gitcheckout.graph.activeBranchOnly');
      } catch {
        return '';
      }
    };
    await vscode.commands.executeCommand('gitCheckout.graph.showActiveBranchOnly');
    await waitFor('the filter on', async () => (value() === 'true' ? true : undefined));
    await ctx.api.sendPanelMessage({ type: 'graphExitActiveBranchOnly' });
    await waitFor('the filter off', async () => (value() === 'false' ? true : undefined));
    await vscode.commands.executeCommand('gitCheckout.graph.showActiveBranchOnly');
    await vscode.commands.executeCommand('gitCheckout.graph.showAllBranches');
    await waitFor('the filter off again', async () => (value() === 'false' ? true : undefined));
  });

  it('copies the hash of a commit the graph asks to copy, and ignores ids that are not graph commands', async () => {
    await readyTree(ctx.api);
    const sha = git('rev-parse', 'HEAD');
    await vscode.env.clipboard.writeText('before');
    const context = { webviewSection: 'commit', graphSelection: 'single', sha, subject: 's', shas: [sha], preventDefaultContextMenuItems: true };
    await ctx.api.sendPanelMessage({ type: 'graphContextCommand', id: 'workbench.action.quit', context });
    assert.equal(await vscode.env.clipboard.readText(), 'before');
    await ctx.api.sendPanelMessage({ type: 'graphContextCommand', id: 'gitCheckout.graph.copyHash', context });
    await waitFor('the copied hash', async () => ((await vscode.env.clipboard.readText()) === sha ? true : undefined));
  });

  it('leaves the clipboard alone when a list shortcut runs with nothing selected', async () => {
    await vscode.env.clipboard.writeText('kept');
    await vscode.commands.executeCommand('gitCheckout.changes.copyPath', { list: 'unstaged' });
    await vscode.commands.executeCommand('gitCheckout.changes.discard', { list: 'unstaged' });
    assert.equal(await vscode.env.clipboard.readText(), 'kept');
  });
});
