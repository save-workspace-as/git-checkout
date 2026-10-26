import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';

import { bindExtension, git, loadTree, readyTree, repoRoot, waitFor } from './harness';

function gitIn(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'protocol.file.allow=always', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();
}

describe('Fetch', () => {
  const ctx = bindExtension();

  it('fetches the chosen remote', async () => {
    await readyTree(ctx.api);
    const root = repoRoot();
    const remoteRoot = mkdtempSync(join(tmpdir(), 'git-checkout-e2e-remote-'));

    git('config', 'protocol.file.allow', 'always');
    gitIn(remoteRoot, 'init', '--bare', '-b', 'main');
    git('remote', 'add', 'origin', remoteRoot);
    writeFileSync(join(root, 'tracked.txt'), 'base\n');
    git('add', 'tracked.txt');
    git('commit', '-m', 'track');
    git('push', '-u', 'origin', 'main');

    const other = mkdtempSync(join(tmpdir(), 'git-checkout-e2e-other-'));
    gitIn(other, 'clone', remoteRoot, '.');
    gitIn(other, 'config', 'user.name', 'git-checkout-e2e');
    gitIn(other, 'config', 'user.email', 'e2e@git-checkout.local');
    writeFileSync(join(other, 'remote.txt'), 'remote\n');
    gitIn(other, 'add', 'remote.txt');
    gitIn(other, 'commit', '-m', 'remote');
    gitIn(other, 'push', 'origin', 'main');

    const remote = await waitFor('origin remote', async () =>
      (await loadTree(ctx.api)).flatMap((node) => [node, ...node.children])
        .find((node) => node.kind === 'remote' && node.ref === 'origin'));
    const command = vscode.commands.executeCommand('gitCheckout.sidebar.fetchRemote', remote);
    const state = await waitFor('fetch modal', async () => ctx.api.operationFormState());
    assert.equal(state.form.title, 'Fetch');
    assert.equal(state.form.values.remote, 'origin');
    await ctx.api.sendPanelMessage({
      type: 'operationFormMessage', sessionId: state.sessionId,
      message: { type: 'formSubmit', values: { ...state.form.values, all: false } },
    });
    await command;

    assert.equal(
      git('rev-parse', 'origin/main'),
      gitIn(remoteRoot, 'rev-parse', 'HEAD'),
    );
    assert.equal(git('show', 'origin/main:remote.txt'), 'remote');
  });

  it('fetches every configured remote', async () => {
    await readyTree(ctx.api);
    const root = repoRoot();
    const originRoot = mkdtempSync(join(tmpdir(), 'git-checkout-e2e-origin-'));
    const upstreamRoot = mkdtempSync(
      join(tmpdir(), 'git-checkout-e2e-upstream-'),
    );

    git('config', 'protocol.file.allow', 'always');
    gitIn(originRoot, 'init', '--bare', '-b', 'main');
    gitIn(upstreamRoot, 'init', '--bare', '-b', 'main');
    git('remote', 'add', 'origin', originRoot);
    git('remote', 'add', 'upstream', upstreamRoot);
    writeFileSync(join(root, 'tracked.txt'), 'base\n');
    git('add', 'tracked.txt');
    git('commit', '-m', 'track');
    git('push', 'origin', 'main');
    git('push', 'upstream', 'main');

    const originClone = mkdtempSync(
      join(tmpdir(), 'git-checkout-e2e-origin-clone-'),
    );
    gitIn(originClone, 'clone', originRoot, '.');
    gitIn(originClone, 'config', 'user.name', 'git-checkout-e2e');
    gitIn(originClone, 'config', 'user.email', 'e2e@git-checkout.local');
    writeFileSync(join(originClone, 'from-origin.txt'), 'origin\n');
    gitIn(originClone, 'add', 'from-origin.txt');
    gitIn(originClone, 'commit', '-m', 'from origin');
    gitIn(originClone, 'push', 'origin', 'main');

    const upstreamClone = mkdtempSync(
      join(tmpdir(), 'git-checkout-e2e-upstream-clone-'),
    );
    gitIn(upstreamClone, 'clone', upstreamRoot, '.');
    gitIn(upstreamClone, 'config', 'user.name', 'git-checkout-e2e');
    gitIn(upstreamClone, 'config', 'user.email', 'e2e@git-checkout.local');
    writeFileSync(join(upstreamClone, 'from-upstream.txt'), 'upstream\n');
    gitIn(upstreamClone, 'add', 'from-upstream.txt');
    gitIn(upstreamClone, 'commit', '-m', 'from upstream');
    gitIn(upstreamClone, 'push', 'origin', 'main');

    await vscode.commands.executeCommand('gitCheckout.fetch', { all: true });

    assert.equal(git('show', 'origin/main:from-origin.txt'), 'origin');
    assert.equal(git('show', 'upstream/main:from-upstream.txt'), 'upstream');
  });
});
