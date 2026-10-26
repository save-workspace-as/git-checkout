import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';

import { bindExtension, findByRef, git, loadTree, readyTree, repoRoot, waitFor } from './harness';

describe('Create worktree', () => {
  const ctx = bindExtension();

  it('checks out a sidebar branch through the shared worktree form', async () => {
    await readyTree(ctx.api);
    const tree = await loadTree(ctx.api);
    const branch = findByRef(tree, 'agent/feature');
    assert.ok(branch);
    const parent = mkdtempSync(join(tmpdir(), 'git-checkout-worktree-'));
    const destination = join(parent, 'checkout');
    const command = vscode.commands.executeCommand('gitCheckout.sidebar.checkoutAsWorktree', branch);
    try {
      const state = await waitFor('worktree checkout form', async () => ctx.api.operationFormState());
      assert.equal(state.form.title, 'Checkout Branch as Worktree');
      assert.deepEqual(state.form.fields.map((field) => field.id), ['startPoint', 'path']);
      assert.equal(state.form.fields[0].readOnly, true);
      assert.equal(state.form.values.startPoint, 'agent/feature');
      await ctx.api.sendPanelMessage({
        type: 'operationFormMessage', sessionId: state.sessionId,
        message: { type: 'formSubmit', values: { ...state.form.values, path: destination } },
      });
      await command;
      assert.equal(execFileSync('git', ['branch', '--show-current'], {
        cwd: destination, encoding: 'utf8',
      }).trim(), 'agent/feature');
      assert.equal(git('branch', '--show-current'), 'main');
    } finally {
      const active = ctx.api.operationFormState();
      if (active) {
        await ctx.api.sendPanelMessage({
          type: 'operationFormMessage', sessionId: active.sessionId, message: { type: 'formCancel' },
        });
      }
      await command;
      try {
        git('worktree', 'remove', '--force', destination);
      } catch {
        // The worktree was not created.
      }
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('creates a worktree on a new branch from the chosen start ref', async () => {
    await readyTree(ctx.api);
    const parent = mkdtempSync(join(tmpdir(), 'git-checkout-worktree-'));
    const destination = join(parent, 'topic');
    try {
      await vscode.commands.executeCommand('gitCheckout.sidebar.createWorktree', {
        path: destination,
        newBranch: 'topic',
        startPoint: 'agent/feature',
      });

      assert.equal(
        execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
          cwd: destination,
          encoding: 'utf8',
        }).trim(),
        'topic',
      );
      assert.equal(
        execFileSync('git', ['rev-parse', 'HEAD'], { cwd: destination, encoding: 'utf8' }).trim(),
        git('rev-parse', 'agent/feature'),
      );
      assert.equal(git('rev-parse', '--abbrev-ref', 'HEAD'), 'main');

      await waitFor('sidebar lists the new worktree', async () => {
        const tree = await loadTree(ctx.api);
        const worktree = tree
          .find((node) => node.id === 'section:worktrees')
          ?.children.find((node) => node.label === 'topic');
        const branch = findByRef(tree, 'topic');
        return worktree?.kind === 'worktree' && branch?.description === 'checked out' ? true : undefined;
      });
    } finally {
      try {
        git('worktree', 'remove', '--force', destination);
      } catch {
        // The worktree was not created.
      }
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('creates a worktree on a new branch through the Create Worktree form', async () => {
    await readyTree(ctx.api);
    const parent = mkdtempSync(join(tmpdir(), 'git-checkout-worktree-'));
    const destination = join(parent, 'from-form');
    const command = vscode.commands.executeCommand('gitCheckout.sidebar.createWorktree');
    try {
      const state = await waitFor('create worktree form', async () => ctx.api.operationFormState());
      assert.equal(state.form.title, 'Create Worktree');
      assert.deepEqual(state.form.fields.map((field) => field.id), ['startPoint', 'newBranch', 'path']);
      assert.equal(state.form.values.startPoint, 'main');
      await ctx.api.sendPanelMessage({
        type: 'operationFormMessage', sessionId: state.sessionId,
        message: {
          type: 'formSubmit',
          values: { startPoint: 'agent/feature', newBranch: 'from-form', path: destination },
        },
      });
      await command;
      assert.equal(execFileSync('git', ['branch', '--show-current'], {
        cwd: destination, encoding: 'utf8',
      }).trim(), 'from-form');
      assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: destination, encoding: 'utf8' }).trim(),
        git('rev-parse', 'agent/feature'));
      assert.equal(git('branch', '--show-current'), 'main');
    } finally {
      const active = ctx.api.operationFormState();
      if (active) {
        await ctx.api.sendPanelMessage({
          type: 'operationFormMessage', sessionId: active.sessionId, message: { type: 'formCancel' },
        });
      }
      await command;
      try {
        git('worktree', 'remove', '--force', destination);
      } catch {
        // The worktree was not created.
      }
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('copies the worktree path and keeps the current worktree open from its context menu', async () => {
    const tree = await readyTree(ctx.api);
    const current = tree.find((node) => node.id === 'section:worktrees')?.children[0];
    assert.equal(current?.kind, 'worktree');
    assert.ok(current.ref);
    await vscode.env.clipboard.writeText('');
    await vscode.commands.executeCommand('gitCheckout.sidebar.copyWorktreePath', current);
    assert.equal(await vscode.env.clipboard.readText(), current.ref);
    await vscode.commands.executeCommand('gitCheckout.sidebar.openWorktree', current);
    assert.equal(vscode.workspace.workspaceFolders?.some((folder) => folder.uri.fsPath === repoRoot()), true);
  });

  it('rejects an invalid branch name and the current folder', async () => {
    await readyTree(ctx.api);
    const destination = join(tmpdir(), `git-checkout-unused-${Date.now()}`);

    await vscode.commands.executeCommand('gitCheckout.sidebar.createWorktree', {
      path: destination,
      newBranch: 'bad name',
      startPoint: 'main',
    });
    assert.equal(git('branch', '--list', 'bad name'), '');

    await vscode.commands.executeCommand('gitCheckout.sidebar.createWorktree', {
      path: repoRoot(),
      newBranch: 'elsewhere',
      startPoint: 'main',
    });
    assert.equal(git('branch', '--list', 'elsewhere'), '');
  });
});
