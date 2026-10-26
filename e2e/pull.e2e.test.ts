import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';

import { bindExtension, findByRef, git, readyTree, repoRoot, waitFor } from './harness';

function gitIn(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'protocol.file.allow=always', ...args], { cwd, stdio: 'ignore' });
}

describe('Pull', () => {
  const ctx = bindExtension();

  it('pulls the chosen remote branch and restores a stashed edit', async () => {
    await readyTree(ctx.api);
    const root = repoRoot();
    const remoteRoot = mkdtempSync(join(tmpdir(), 'git-checkout-e2e-remote-'));
    const other = mkdtempSync(join(tmpdir(), 'git-checkout-e2e-other-'));

    git('config', 'protocol.file.allow', 'always');
    gitIn(remoteRoot, 'init', '--bare', '-b', 'main');
    git('remote', 'add', 'origin', remoteRoot);
    writeFileSync(join(root, 'tracked.txt'), 'base\n');
    git('add', 'tracked.txt');
    git('commit', '-m', 'track');
    git('push', '-u', 'origin', 'main');

    gitIn(other, 'clone', remoteRoot, '.');
    gitIn(other, 'config', 'user.name', 'git-checkout-e2e');
    gitIn(other, 'config', 'user.email', 'e2e@git-checkout.local');
    gitIn(other, 'config', 'protocol.file.allow', 'always');
    writeFileSync(join(other, 'remote.txt'), 'remote\n');
    gitIn(other, 'add', 'remote.txt');
    gitIn(other, 'commit', '-m', 'remote');
    gitIn(other, 'push', 'origin', 'main');

    writeFileSync(join(root, 'tracked.txt'), 'local edit\n');
    const tree = (await ctx.api.sidebar.getChildren()) ?? [];
    const branch = findByRef(tree, 'main');
    assert.ok(branch);
    const command = vscode.commands.executeCommand('gitCheckout.sidebar.pullBranch', branch);
    const state = await waitFor('pull modal', async () => ctx.api.operationFormState());
    assert.equal(state.form.title, 'Pull');
    assert.equal(state.form.values.into, 'main');
    await ctx.api.sendPanelMessage({
      type: 'operationFormMessage', sessionId: state.sessionId,
      message: { type: 'formSubmit', values: {
        ...state.form.values, remote: 'origin', branch: 'main', rebase: true, stash: true,
      } },
    });
    await command;

    assert.equal(git('log', '-1', '--format=%s'), 'remote');
    assert.equal(git('show', 'HEAD:remote.txt'), 'remote');
    assert.match(git('status', '--porcelain'), /tracked\.txt/);
    assert.equal(git('stash', 'list'), '');
  });

  it('offers the local branches in the Into dropdown and fast-forwards a branch that is not checked out', async () => {
    await readyTree(ctx.api);
    const root = repoRoot();
    const remoteRoot = mkdtempSync(join(tmpdir(), 'git-checkout-e2e-remote-'));
    const other = mkdtempSync(join(tmpdir(), 'git-checkout-e2e-other-'));

    git('config', 'protocol.file.allow', 'always');
    gitIn(remoteRoot, 'init', '--bare', '-b', 'main');
    git('remote', 'add', 'origin', remoteRoot);
    writeFileSync(join(root, 'tracked.txt'), 'base\n');
    git('add', 'tracked.txt');
    git('commit', '-m', 'track');
    git('push', '-u', 'origin', 'main');
    git('branch', 'side');

    gitIn(other, 'clone', remoteRoot, '.');
    gitIn(other, 'config', 'user.name', 'git-checkout-e2e');
    gitIn(other, 'config', 'user.email', 'e2e@git-checkout.local');
    writeFileSync(join(other, 'remote.txt'), 'remote\n');
    gitIn(other, 'add', 'remote.txt');
    gitIn(other, 'commit', '-m', 'remote');
    gitIn(other, 'push', 'origin', 'main');
    const before = git('rev-parse', 'main');

    const command = vscode.commands.executeCommand('gitCheckout.sidebar.pullBranch', findByRef((await ctx.api.sidebar.getChildren()) ?? [], 'main'));
    const state = await waitFor('pull modal', async () => ctx.api.operationFormState());
    const into = state.form.fields.find((field) => field.id === 'into');
    assert.equal(into?.readOnly, undefined);
    assert.deepEqual(into?.suggestions?.map((suggestion) => suggestion.value), ['main', 'agent/feature', 'side']);
    await ctx.api.sendPanelMessage({
      type: 'operationFormMessage', sessionId: state.sessionId,
      message: { type: 'formSubmit', values: { ...state.form.values, remote: 'origin', branch: 'main', into: 'side' } },
    });
    await command;

    assert.equal(git('show', 'side:remote.txt'), 'remote');
    assert.equal(git('rev-parse', 'main'), before, 'the checked-out branch stays');
    assert.equal(git('branch', '--show-current'), 'main');
  });
});
