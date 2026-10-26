import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';

import { bindExtension, findByRef, git, readyTree, repoRoot, waitFor } from './harness';

function gitIn(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'protocol.file.allow=always', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();
}

describe('Push', () => {
  const ctx = bindExtension();

  it('pushes the chosen branch and all tags', async () => {
    await readyTree(ctx.api);
    const root = repoRoot();
    const remoteRoot = mkdtempSync(join(tmpdir(), 'git-checkout-e2e-remote-'));

    git('config', 'protocol.file.allow', 'always');
    gitIn(remoteRoot, 'init', '--bare', '-b', 'main');
    git('remote', 'add', 'origin', remoteRoot);
    writeFileSync(join(root, 'tracked.txt'), 'base\n');
    git('add', 'tracked.txt');
    git('commit', '-m', 'track');

    const tree = (await ctx.api.sidebar.getChildren()) ?? [];
    const branch = findByRef(tree, 'main');
    assert.ok(branch);
    const command = vscode.commands.executeCommand('gitCheckout.sidebar.pushBranch', branch);
    const state = await waitFor('push modal', async () => ctx.api.operationFormState());
    assert.equal(state.form.title, 'Push');
    assert.equal(state.form.values.branch, 'main');
    await ctx.api.sendPanelMessage({
      type: 'operationFormMessage', sessionId: state.sessionId,
      message: { type: 'formSubmit', values: {
        ...state.form.values, remote: 'origin', branch: 'main', tags: true, force: false,
      } },
    });
    await command;

    assert.equal(gitIn(remoteRoot, 'log', '-1', '--format=%s'), 'track');
    assert.equal(gitIn(remoteRoot, 'show', 'HEAD:tracked.txt'), 'base');
    assert.equal(gitIn(remoteRoot, 'tag', '-l', 'v1.0.0'), 'v1.0.0');
    assert.equal(git('rev-parse', '--abbrev-ref', '@{upstream}'), 'origin/main');
  });
});
