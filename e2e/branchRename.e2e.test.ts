import { strict as assert } from 'node:assert';
import * as vscode from 'vscode';

import { bindExtension, findByRef, git, readyTree, waitFor } from './harness';

describe('Rename branch', () => {
  const ctx = bindExtension();

  it('renames a local branch and leaves the current branch in place', async () => {
    await readyTree(ctx.api);
    await vscode.commands.executeCommand('gitCheckout.sidebar.renameBranch', {
      ref: 'agent/feature',
      name: 'agent/renamed',
      renameRemote: false,
    });

    assert.equal(git('rev-parse', '--abbrev-ref', 'HEAD'), 'main');
    assert.ok(git('rev-parse', '--verify', 'refs/heads/agent/renamed'));
    assert.equal(git('branch', '--list', 'agent/feature'), '');
    await waitFor('sidebar lists agent/renamed', async () =>
      findByRef((await ctx.api.sidebar.getChildren()) ?? [], 'agent/renamed') ? true : undefined,
    );
  });

  it('renames the checked-out branch', async () => {
    await readyTree(ctx.api);
    await vscode.commands.executeCommand('gitCheckout.sidebar.renameBranch', {
      ref: 'main',
      name: 'mainline',
      renameRemote: false,
    });

    assert.equal(git('rev-parse', '--abbrev-ref', 'HEAD'), 'mainline');
    assert.equal(git('branch', '--list', 'main'), '');
    await waitFor('sidebar marks mainline as HEAD', async () =>
      findByRef((await ctx.api.sidebar.getChildren()) ?? [], 'mainline')?.isHead ? true : undefined,
    );
  });
});
