import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';

import { bindExtension, git, readyTree, waitFor } from './harness';

function gitIn(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'protocol.file.allow=always', ...args], { cwd, stdio: 'ignore' });
}

describe('Auto-fetch', () => {
  const ctx = bindExtension();

  async function pushFromElsewhere(remoteRoot: string, subject: string): Promise<void> {
    const other = mkdtempSync(join(tmpdir(), 'git-checkout-e2e-other-'));
    gitIn(other, 'clone', remoteRoot, '.');
    gitIn(other, 'config', 'user.name', 'git-checkout-e2e');
    gitIn(other, 'config', 'user.email', 'e2e@git-checkout.local');
    writeFileSync(join(other, 'remote.txt'), `${subject}\n`);
    gitIn(other, 'add', 'remote.txt');
    gitIn(other, 'commit', '-m', subject);
    gitIn(other, 'push', 'origin', 'main');
  }

  it('brings in what others pushed, so the graph shows it without a manual fetch', async () => {
    await readyTree(ctx.api);
    const remoteRoot = mkdtempSync(join(tmpdir(), 'git-checkout-e2e-remote-'));
    gitIn(remoteRoot, 'init', '--bare', '-b', 'main');
    git('config', 'protocol.file.allow', 'always');
    git('remote', 'add', 'origin', remoteRoot);
    git('push', '-u', 'origin', 'main');
    await pushFromElsewhere(remoteRoot, 'pushed by a teammate');
    assert.notEqual(git('log', '-1', '--format=%s', 'origin/main'), 'pushed by a teammate');

    await ctx.api.autoFetchNow();

    assert.equal(git('log', '-1', '--format=%s', 'origin/main'), 'pushed by a teammate');
    await waitFor('the fetched commit in the graph', async () =>
      (await ctx.api.graphCommits()).some((commit) => commit.subject === 'pushed by a teammate') ? true : undefined);
    assert.equal(git('rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  });

  it('leaves a repository without a remote alone', async () => {
    await readyTree(ctx.api);
    await ctx.api.autoFetchNow();
    assert.equal(git('remote'), '');
  });

  it('does nothing while the setting is off', async () => {
    await readyTree(ctx.api);
    const remoteRoot = mkdtempSync(join(tmpdir(), 'git-checkout-e2e-remote-'));
    gitIn(remoteRoot, 'init', '--bare', '-b', 'main');
    git('config', 'protocol.file.allow', 'always');
    git('remote', 'add', 'origin', remoteRoot);
    git('push', '-u', 'origin', 'main');
    await pushFromElsewhere(remoteRoot, 'not fetched');
    const config = vscode.workspace.getConfiguration('gitCheckout');
    await config.update('autoFetch.enabled', false, vscode.ConfigurationTarget.Global);
    try {
      await ctx.api.autoFetchNow();
      assert.notEqual(git('log', '-1', '--format=%s', 'origin/main'), 'not fetched');
    } finally {
      await config.update('autoFetch.enabled', undefined, vscode.ConfigurationTarget.Global);
    }
  });
});
