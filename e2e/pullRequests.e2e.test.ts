import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';

import { answer, cancelForm, commitFile } from './graphMenu';
import { bindExtension, git, loadTree, readyTree, repoRoot, waitFor, type SidebarNode } from './harness';

const walk = (node: SidebarNode): SidebarNode[] => [node, ...(node.children ?? []).flatMap(walk)];

describe('Pull requests in the sidebar', () => {
  const ctx = bindExtension();
  let remote = '';
  let head = '';
  let undo: (() => void)[] = [];
  const opened: string[] = [];

  const pull = (over: Record<string, unknown> = {}) => ({
    number: 7, title: 'Speed up blame', author: 'ada', isDraft: false, headRef: 'speed', headRepository: 'octo/app', baseRef: 'main',
    reviewDecision: null, updatedAt: '2026-10-30T10:00:00Z', url: 'https://github.com/octo/app/pull/7', ...over,
  });
  const seed = (pulls = [pull()]) => ctx.api.seedPullRequests(repoRoot(), {
    kind: 'ready', remote: 'origin', repo: { host: 'github.com', owner: 'octo', repo: 'app' },
    lists: { createdByMe: [], reviewRequested: [], allOpen: pulls },
  });
  const pullNode = async (): Promise<SidebarNode> =>
    waitFor('the pull request row', async () => (await loadTree(ctx.api)).flatMap(walk).find((node) => node.kind === 'pullRequest' && node.ref === '7'));
  /** Pushes a new head of pull request 7, as GitHub keeps it. */
  const pushHead = (sha: string): void => { git('push', '-q', '--force', 'origin', `${sha}:refs/pull/7/head`); };

  beforeEach(async () => {
    await readyTree(ctx.api);
    opened.length = 0;
    head = commitFile('base.txt', 'base\n', 'base');
    remote = mkdtempSync(join(tmpdir(), 'git-checkout-e2e-pr-'));
    git('init', '--bare', '-q', remote);
    git('remote', 'add', 'origin', remote);
    git('checkout', '-q', '-b', 'speed');
    head = commitFile('speed.txt', 'fast\n', 'make it fast');
    git('checkout', '-q', 'main');
    git('branch', '-D', 'speed');
    pushHead(head);
    const env = vscode.env as unknown as { openExternal: (uri: vscode.Uri) => Thenable<boolean> };
    const original = env.openExternal;
    env.openExternal = async (uri) => { opened.push(uri.toString()); return true; };
    undo = [() => { env.openExternal = original; }];
    seed();
  });

  afterEach(async () => {
    for (const restore of undo) { restore(); }
    await vscode.workspace.getConfiguration('gitCheckout').update('pullRequests.enabled', undefined, vscode.ConfigurationTarget.Global);
    rmSync(remote, { recursive: true, force: true });
  });

  it('lists the pull requests after the remotes, by category', async () => {
    const node = await pullNode();
    assert.equal(node.label, 'Speed up blame');
    assert.equal(node.description, '#7 by ada');
    const tree = await loadTree(ctx.api);
    const labels = tree.map((entry) => entry.label);
    assert.equal(labels[labels.indexOf('Remotes') + 1], 'Pull Requests');
    const categories = tree.find((entry) => entry.label === 'Pull Requests')!.children.map((child) => child.label);
    assert.deepEqual(categories, ['Created by me', 'Waiting for my review', 'All open']);
  });

  it('checks a pull request out as the branch pr/<n>, and moves it forward when the pull request changes', async () => {
    await vscode.commands.executeCommand('gitCheckout.pullRequests.checkout', await pullNode());
    assert.equal(git('branch', '--show-current'), 'pr/7');
    assert.equal(git('rev-parse', 'HEAD'), head);

    git('checkout', '-q', 'pr/7');
    const next = commitFile('more.txt', 'more\n', 'one more');
    git('checkout', '-q', 'main');
    pushHead(next);
    git('branch', '-f', 'pr/7', head);
    await vscode.commands.executeCommand('gitCheckout.pullRequests.checkout', await pullNode());
    assert.equal(git('rev-parse', 'pr/7'), next);
    assert.equal(git('branch', '--show-current'), 'pr/7');
  });

  it('asks before it moves a pr/<n> that has commits of its own, and leaves it when the answer is no', async () => {
    git('branch', 'pr/7', 'main');
    git('checkout', '-q', 'pr/7');
    const mine = commitFile('mine.txt', 'mine\n', 'my own work');
    git('checkout', '-q', 'main');
    const asked: string[] = [];
    undo.push(answer('showWarningMessage', async (message: unknown) => { asked.push(String(message)); return undefined; }));
    await vscode.commands.executeCommand('gitCheckout.pullRequests.checkout', await pullNode());
    assert.match(asked[0] ?? '', /'pr\/7' has commits that are not in this pull request/);
    assert.equal(git('rev-parse', 'pr/7'), mine, 'declined, so nothing moved');
    assert.equal(git('branch', '--show-current'), 'main');

    undo.push(answer('showWarningMessage', async (_message: unknown, _options: unknown, reset: unknown) => reset));
    await vscode.commands.executeCommand('gitCheckout.pullRequests.checkout', await pullNode());
    assert.equal(git('rev-parse', 'pr/7'), head);
    assert.equal(git('branch', '--show-current'), 'pr/7');
  });

  it('prepares the branch and opens the worktree form for it, without leaving the current branch', async () => {
    const command = vscode.commands.executeCommand('gitCheckout.pullRequests.checkoutInWorktree', await pullNode());
    const state = await waitFor('the worktree form', async () => ctx.api.operationFormState());
    assert.equal(git('rev-parse', 'pr/7'), head);
    assert.equal(git('branch', '--show-current'), 'main');
    assert.match(state.form.title, /Worktree/);
    await cancelForm(ctx.api, command, state.form.title);
  });

  it('opens the pull request on GitHub, and copies its link', async () => {
    await vscode.commands.executeCommand('gitCheckout.pullRequests.openOnGitHub', await pullNode());
    assert.deepEqual(opened, ['https://github.com/octo/app/pull/7']);
    await vscode.commands.executeCommand('gitCheckout.pullRequests.copyLink', await pullNode());
    assert.equal(await vscode.env.clipboard.readText(), 'https://github.com/octo/app/pull/7');
  });

  it('refuses a link that is not a pull request of this repository', async () => {
    seed([pull({ url: 'https://evil.example.com/octo/app/pull/7' })]);
    await vscode.commands.executeCommand('gitCheckout.pullRequests.openOnGitHub', await pullNode());
    assert.deepEqual(opened, []);
  });

  it('reads again on Refresh, and leaves the section out when the repository is not on GitHub or the setting is off', async () => {
    await pullNode();
    await vscode.commands.executeCommand('gitCheckout.pullRequests.refresh');
    // The remote of this repository is a folder, so there is no GitHub to read from.
    await waitFor('the section to go', async () => ((await loadTree(ctx.api)).some((entry) => entry.label === 'Pull Requests') ? undefined : true));

    seed();
    await pullNode();
    await vscode.workspace.getConfiguration('gitCheckout').update('pullRequests.enabled', false, vscode.ConfigurationTarget.Global);
    await waitFor('the section to go with the setting', async () => ((await loadTree(ctx.api)).some((entry) => entry.label === 'Pull Requests') ? undefined : true));
  });
});
