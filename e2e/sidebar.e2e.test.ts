import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';

import {
  assertCommands,
  bindExtension,
  branchesOf,
  findByRef,
  git,
  loadTree,
  readyRef,
  readyTree,
  repoRoot,
  waitFor,
  waitForGitCheckoutPanel } from './harness';

describe('Git Checkout sidebar', () => {
  const ctx = bindExtension();

  it('registers every command contributed by the extension', async () => {
    await assertCommands(ctx.extension);
  });

  it('lists the fixture repository refs', async () => {
    const tree = await readyTree(ctx.api);

    assert.deepEqual(
      tree.map((node) => node.label),
      ['Changes', 'History', 'Branches', 'Remotes', 'Tags', 'Stashes', 'Worktrees', 'Submodules'],
    );
    const branches = branchesOf(tree);
    assert.deepEqual(
      branches.map((node) => node.label),
      ['agent', 'main'],
    );
    assert.equal(branches[0].children[0].ref, 'agent/feature');
    assert.equal(branches[1].isHead, true);
    const tags = tree.find((node) => node.id === 'section:tags')?.children ?? [];
    assert.deepEqual(
      tags.map((node) => node.label),
      ['v1.0.0'],
    );
    const worktrees = tree.find((node) => node.id === 'section:worktrees')?.children ?? [];
    assert.deepEqual(
      worktrees.map((node) => node.label),
      ['main'],
    );
    assert.equal(worktrees[0].kind, 'worktree');
    assert.ok(worktrees[0].ref);
  });

  it('filters the sidebar to a matching branch and checks it out', async () => {
    await readyTree(ctx.api);
    try {
      await vscode.commands.executeCommand('gitCheckout.sidebar.search', 'agent/feature');

      const feature = await waitFor('filtered agent/feature', async () => {
        const tree = await loadTree(ctx.api);
        if (tree.some((node) => node.kind === 'section' && node.id === 'section:tags')) {
          return undefined;
        }
        return findByRef(tree, 'agent/feature');
      });
      assert.equal(feature.kind, 'branch');
      assert.equal(
        (await loadTree(ctx.api)).some((node) => node.label === 'Search'),
        false,
        'search is not a sidebar row',
      );

      await vscode.commands.executeCommand('gitCheckout.sidebar.checkout', feature);
      assert.equal(git('rev-parse', '--abbrev-ref', 'HEAD'), 'agent/feature');
    } finally {
      await vscode.commands.executeCommand('gitCheckout.sidebar.clearSearch');
    }
    await waitFor('branch list restored', async () =>
      branchesOf(await loadTree(ctx.api)).length >= 2 ? true : undefined,
    );
  });

  it('opens the Git Checkout panel when showing a ref in the graph', async () => {
    await vscode.commands.executeCommand(
      'gitCheckout.sidebar.revealInGraph',
      await readyRef(ctx.api, 'main'),
    );
    await waitForGitCheckoutPanel();
  });

  it('checks out a slash-named local branch as itself', async () => {
    await vscode.commands.executeCommand(
      'gitCheckout.sidebar.checkout',
      await readyRef(ctx.api, 'agent/feature'),
    );

    assert.equal(git('rev-parse', '--abbrev-ref', 'HEAD'), 'agent/feature');
    assert.equal(git('branch', '--list', 'feature'), '');

    await waitFor('sidebar to mark agent/feature as HEAD', async () =>
      findByRef(await loadTree(ctx.api), 'agent/feature')?.isHead ? true : undefined,
    );
  });

  it('counts local changes without listing them: the Changes tab does that', async () => {
    await readyTree(ctx.api);
    writeFileSync(join(repoRoot(), 'notes.txt'), 'hello\n');

    const local = await waitFor('Changes count', async () => {
      const node = (await loadTree(ctx.api)).find((entry) => entry.id === 'localChanges');
      return node?.description === '1' ? node : undefined;
    });
    assert.equal(local.children.length, 0);
    assert.equal(findByRef(await loadTree(ctx.api), 'notes.txt'), undefined);
  });

  it('counts pending changes on the Git Checkout icon, and follows scm.countBadge', async () => {
    await readyTree(ctx.api);
    writeFileSync(join(repoRoot(), 'badge-one.txt'), 'one\n');
    writeFileSync(join(repoRoot(), 'badge-two.txt'), 'two\n');
    // The count comes from VS Code's Git extension, whose file watching can lag in a long test run; ask it to look.
    await vscode.commands.executeCommand('git.refresh');
    await waitFor('two changes on the icon', async () => (ctx.api.activityBadge() === 2 ? true : undefined));
    git('add', 'badge-one.txt');
    await vscode.commands.executeCommand('git.refresh');
    await waitFor('a staged change still counts', async () => (ctx.api.activityBadge() === 2 ? true : undefined));
    const scm = vscode.workspace.getConfiguration('scm');
    await scm.update('countBadge', 'off', vscode.ConfigurationTarget.Global);
    try {
      await waitFor('no badge when counting is off', async () => (ctx.api.activityBadge() === undefined ? true : undefined));
    } finally {
      await scm.update('countBadge', undefined, vscode.ConfigurationTarget.Global);
    }
    git('add', 'badge-two.txt');
    git('commit', '-m', 'badge');
    await vscode.commands.executeCommand('git.refresh');
    await waitFor('no badge once everything is committed', async () => (ctx.api.activityBadge() === undefined ? true : undefined));
  });
});

