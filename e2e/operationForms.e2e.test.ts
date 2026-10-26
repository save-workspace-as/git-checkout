import { strict as assert } from 'node:assert';
import * as vscode from 'vscode';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bindExtension, findByRef, git, readyTree, repoRoot, waitFor } from './harness';

describe('Shared operation forms', () => {
  const ctx = bindExtension();

  it('shows full commit details for a tag in the shared modal', async () => {
    const nodes = await readyTree(ctx.api);
    const tag = findByRef(nodes, 'v1.0.0');
    assert.ok(tag);
    const command = vscode.commands.executeCommand('gitCheckout.sidebar.showTagDetails', tag);
    const state = await waitFor('tag details modal', async () => ctx.api.operationFormState());
    assert.equal(state.form.title, 'Tag Details');
    assert.equal(state.form.values.tag, 'v1.0.0');
    assert.equal(state.form.values.message, 'init');
    assert.equal(state.form.fields.find((field) => field.id === 'message')?.multiline, true);
    await ctx.api.sendPanelMessage({
      type: 'operationFormMessage', sessionId: state.sessionId, message: { type: 'formCancel' },
    });
    await command;
  });

  it('opens the single New Tag form from the Tags section', async () => {
    const nodes = await readyTree(ctx.api);
    const tagsSection = nodes.find((node) => node.id === 'section:tags');
    assert.ok(tagsSection);
    const command = vscode.commands.executeCommand('gitCheckout.sidebar.createTag', tagsSection);
    const state = await waitFor('New Tag modal', async () => ctx.api.operationFormState());
    assert.equal(state.form.title, 'Create Tag');
    assert.equal(state.form.fields.find((field) => field.id === 'objectRef')?.description, 'The revision this tag points to.');
    assert.equal(state.form.fields.find((field) => field.id === 'name')?.description, 'Create an annotated tag, which stores a message.');
    assert.equal(state.form.fields.find((field) => field.id === 'message')?.description, 'The message stored with this annotated tag.');
    assert.equal(state.form.fields.find((field) => field.id === 'pushAllRemotes')?.description, 'Push this tag to every remote.');
    assert.equal(state.form.values.objectRef, 'main');
    assert.deepEqual(state.form.fields.map((field) => field.id), [
      'objectRef', 'name', 'message', 'pushAllRemotes',
    ]);
    assert.equal(state.form.fields.find((field) => field.id === 'message')?.multiline, true);
    await ctx.api.sendPanelMessage({
      type: 'operationFormMessage', sessionId: state.sessionId, message: { type: 'formCancel' },
    });
    await command;
  });

  it('opens the merge options modal for a branch', async () => {
    const nodes = await readyTree(ctx.api);
    const branch = findByRef(nodes, 'agent/feature');
    assert.ok(branch);
    const command = vscode.commands.executeCommand('gitCheckout.sidebar.merge', branch);
    const state = await waitFor('merge options modal', async () => ctx.api.operationFormState());
    assert.equal(state.form.title, 'Merge');
    assert.equal(state.form.values.source, 'agent/feature');
    assert.equal(state.form.values.target, 'main');
    assert.deepEqual(state.form.fields.find((field) => field.id === 'mergeType')?.suggestions?.map((entry) => entry.value), [
      'Default', 'Fast-forward if possible',
    ]);
    await ctx.api.sendPanelMessage({
      type: 'operationFormMessage', sessionId: state.sessionId, message: { type: 'formCancel' },
    });
    await command;
  });

  it('opens the rebase options modal for a branch', async () => {
    const nodes = await readyTree(ctx.api);
    const branch = findByRef(nodes, 'agent/feature');
    assert.ok(branch);
    const command = vscode.commands.executeCommand('gitCheckout.sidebar.rebase', branch);
    const state = await waitFor('rebase options modal', async () => ctx.api.operationFormState());
    assert.equal(state.form.title, 'Rebase');
    assert.equal(state.form.values.source, 'main');
    assert.equal(state.form.values.target, 'agent/feature');
    assert.equal(state.form.values.updateDependentBranches, false);
    assert.equal(state.form.values.stashAndReapply, false);
    assert.equal(state.form.notice?.message, 'Rebase can complete without conflicts');
    await ctx.api.sendPanelMessage({
      type: 'operationFormMessage', sessionId: state.sessionId, message: { type: 'formCancel' },
    });
    await command;
  });

  it('opens and cancels the branch deletion modal without changing Git state', async () => {
    const nodes = await readyTree(ctx.api);
    const branch = findByRef(nodes, 'agent/feature');
    assert.ok(branch);
    const before = git('branch', '--list', 'agent/feature');
    const command = vscode.commands.executeCommand('gitCheckout.sidebar.deleteBranch', branch);
    const state = await waitFor('delete branch modal', async () => ctx.api.operationFormState());
    assert.equal(state.form.title, 'Delete Branch');
    assert.equal(state.form.fields.find((field) => field.id === 'name')?.description, 'Delete this local branch.');
    assert.equal(state.form.values.name, 'agent/feature');
    await ctx.api.sendPanelMessage({
      type: 'operationFormMessage', sessionId: state.sessionId, message: { type: 'formCancel' },
    });
    await command;
    assert.equal(git('branch', '--list', 'agent/feature'), before);
  });

  it('opens pull and remote deletion modals from a remote branch', async () => {
    await readyTree(ctx.api);
    git('remote', 'add', 'origin', repoRoot());
    const remoteSha = git('rev-parse', 'agent/feature');
    git('update-ref', 'refs/remotes/origin/agent/feature', remoteSha);
    const remoteBranch = await waitFor('remote branch node', async () => {
      return findByRef(await ctx.api.sidebar.getChildren() ?? [], 'origin/agent/feature');
    });

    const pull = vscode.commands.executeCommand('gitCheckout.sidebar.pullBranch', remoteBranch);
    const pullState = await waitFor('remote pull modal', async () => ctx.api.operationFormState());
    assert.equal(pullState.form.title, 'Pull');
    assert.equal(pullState.form.values.remote, 'origin');
    assert.equal(pullState.form.values.branch, 'agent/feature');
    assert.equal(pullState.form.values.into, 'main');
    await ctx.api.sendPanelMessage({
      type: 'operationFormMessage', sessionId: pullState.sessionId, message: { type: 'formCancel' },
    });
    await pull;

    const deletion = vscode.commands.executeCommand('gitCheckout.sidebar.deleteBranch', remoteBranch);
    const deleteState = await waitFor('remote branch deletion modal', async () => ctx.api.operationFormState());
    assert.equal(deleteState.form.title, 'Delete Branch');
    assert.equal(deleteState.form.fields.find((field) => field.id === 'name')?.description, 'Delete this branch from the remote.');
    assert.equal(deleteState.form.values.name, 'origin/agent/feature');
    await ctx.api.sendPanelMessage({
      type: 'operationFormMessage', sessionId: deleteState.sessionId, message: { type: 'formCancel' },
    });
    await deletion;
    assert.equal(git('rev-parse', '--verify', 'refs/remotes/origin/agent/feature'), remoteSha);
  });

  for (const title of ['Fetch', 'Pull', 'Push']) {
    it(`cancels ${title} without running a Git operation`, async () => {
      await readyTree(ctx.api);
      git('remote', 'add', 'origin', repoRoot());
      git('update-ref', 'refs/remotes/origin/main', 'HEAD');
      const before = [git('show-ref'), git('status', '--porcelain'), git('config', '--local', '--list')];
      const command = vscode.commands.executeCommand(`gitCheckout.${title.toLowerCase()}`);
      const state = await waitFor(`${title} modal`, async () => ctx.api.operationFormState());
      assert.equal(state.form.title, title);
      await ctx.api.sendPanelMessage({
        type: 'operationFormMessage', sessionId: state.sessionId, message: { type: 'formCancel' },
      });
      await command;
      assert.equal(ctx.api.operationFormState(), undefined);
      assert.deepEqual([git('show-ref'), git('status', '--porcelain'), git('config', '--local', '--list')], before);
    });
  }

  it('opens the compact submodule form with folder and recursive fetching and validates paths', async () => {
    await readyTree(ctx.api);
    const command = vscode.commands.executeCommand('gitCheckout.sidebar.addSubmodule');
    const state = await waitFor('submodule modal', async () => ctx.api.operationFormState());
    assert.deepEqual(state.form.fields.map((field) => field.id), ['url', 'path', 'recursive']);
    assert.equal(state.form.values.recursive, false);
    await ctx.api.sendPanelMessage({
      type: 'operationFormMessage', sessionId: state.sessionId,
      message: { type: 'formSubmit', values: { url: '--bad', path: '../outside', recursive: true } },
    });
    assert.ok(ctx.api.operationFormState());
    assert.equal(git('submodule', 'status'), '');
    assert.equal(git('status', '--porcelain'), '');
    await ctx.api.sendPanelMessage({
      type: 'operationFormMessage', sessionId: state.sessionId, message: { type: 'formCancel' },
    });
    await command;
  });

  it('populates branch and stash dropdowns in the modal without separate picker buttons', async () => {
    await readyTree(ctx.api);
    git('tag', 'dropdown-v1');
    const branchCommand = vscode.commands.executeCommand('gitCheckout.sidebar.createBranch');
    const branch = await waitFor('branch dropdown', async () => ctx.api.operationFormState());
    try {
      const field = branch.form.fields.find((entry) => entry.id === 'startPoint');
      assert.equal(field?.pickLabel, undefined);
      assert.ok(field?.suggestions?.some((entry) => entry.value === 'refs/tags/dropdown-v1'));
      assert.ok(field?.suggestions?.some((entry) => entry.value === 'refs/heads/main'));
    } finally {
      await ctx.api.sendPanelMessage({
        type: 'operationFormMessage', sessionId: branch.sessionId, message: { type: 'formCancel' },
      });
      await branchCommand;
    }
    writeFileSync(join(repoRoot(), 'dropdown.txt'), 'saved\n');
    git('add', 'dropdown.txt');
    git('stash', 'push', '-m', 'existing message');
    const before = git('stash', 'list');
    const stashCommand = vscode.commands.executeCommand('gitCheckout.sidebar.createStash');
    const stash = await waitFor('stash dropdown', async () => ctx.api.operationFormState());
    try {
      const field = stash.form.fields.find((entry) => entry.id === 'message');
      assert.equal(field?.pickLabel, undefined);
      assert.ok(field?.suggestions?.some((entry) => entry.value.includes('existing message')));
    } finally {
      await ctx.api.sendPanelMessage({
        type: 'operationFormMessage', sessionId: stash.sessionId, message: { type: 'formCancel' },
      });
      await stashCommand;
    }
    assert.equal(git('stash', 'list'), before);
  });

  for (const annotated of [false, true]) {
    it(`submits ${annotated ? 'an annotated' : 'a lightweight'} tag modal and closes it on success`, async () => {
      await readyTree(ctx.api);
      const command = vscode.commands.executeCommand(
        annotated ? 'gitCheckout.sidebar.createTagAnnotated' : 'gitCheckout.sidebar.createTagLight',
      );
      const state = await waitFor('tag modal', async () => ctx.api.operationFormState());
      await ctx.api.sendPanelMessage({
        type: 'operationFormMessage', sessionId: state.sessionId,
        message: { type: 'formSubmit', values: { ...state.form.values, name: 'modal-v1', message: 'Release', sign: false } },
      });
      await command;
      assert.equal(git('cat-file', '-t', 'refs/tags/modal-v1'), annotated ? 'tag' : 'commit');
      assert.equal(ctx.api.operationFormState(), undefined);
    });
  }

  it('saves changes using an existing stash message and preserves the original stash', async () => {
    await readyTree(ctx.api);
    writeFileSync(join(repoRoot(), 'existing.txt'), 'saved\n');
    git('add', 'existing.txt');
    git('stash', 'push', '-m', 'existing message');
    const original = git('rev-parse', 'stash@{0}');
    writeFileSync(join(repoRoot(), 'modal-new.txt'), 'new\n');
    const command = vscode.commands.executeCommand('gitCheckout.sidebar.createStash');
    const state = await waitFor('stash modal', async () => ctx.api.operationFormState());
    await ctx.api.sendPanelMessage({
      type: 'operationFormMessage', sessionId: state.sessionId,
      message: { type: 'formSubmit', values: { ...state.form.values, includeUntracked: true } },
    });
    await command;
    assert.match(git('stash', 'list'), /existing message/);
    assert.equal(git('rev-parse', 'stash@{1}'), original);
    assert.equal(git('status', '--porcelain'), '');
    assert.equal(ctx.api.operationFormState(), undefined);
  });

  it('saves with the Git default message when no existing stash messages are available', async () => {
    await readyTree(ctx.api);
    writeFileSync(join(repoRoot(), 'modal-new.txt'), 'new\n');
    const command = vscode.commands.executeCommand('gitCheckout.sidebar.createStash');
    const state = await waitFor('stash modal', async () => ctx.api.operationFormState());
    assert.equal(state.form.values.message, '');
    await ctx.api.sendPanelMessage({
      type: 'operationFormMessage', sessionId: state.sessionId,
      message: { type: 'formSubmit', values: { ...state.form.values, includeUntracked: true } },
    });
    await command;
    assert.match(git('stash', 'list'), /WIP on main/);
    assert.equal(git('status', '--porcelain'), '');
    assert.equal(ctx.api.operationFormState(), undefined);
  });

  for (const [command, title] of [
    ['gitCheckout.sidebar.createWorktree', 'Create Worktree'],
    ['gitCheckout.sidebar.createTagLight', 'Create Tag'],
    ['gitCheckout.sidebar.createTagAnnotated', 'Create Tag'],
    ['gitCheckout.sidebar.createStash', 'Save Stash'],
    ['gitCheckout.sidebar.addSubmodule', 'Add Submodule'],
  ]) {
    it(`opens and cancels ${title} without changing Git state`, async () => {
      await readyTree(ctx.api);
      const snapshot = () => [
        git('show-ref'), git('status', '--porcelain'), git('worktree', 'list', '--porcelain'),
        git('stash', 'list'), git('submodule', 'status'), git('config', '--local', '--list'),
      ];
      const before = snapshot();
      const pending = vscode.commands.executeCommand(command);
      const state = await waitFor(`${title} modal`, async () => ctx.api.operationFormState());
      const tab = await waitFor('Git Checkout tab', async () =>
        vscode.window.tabGroups.all.flatMap((group) => group.tabs).find(
          (entry) => entry.input instanceof vscode.TabInputWebview
            && entry.input.viewType.includes('gitCheckout.main'),
        ),
      );
      try {
        assert.equal(tab.label, 'Git Checkout');
        assert.equal(state.form.title, title);
        if (title.includes('Tag')) {
          assert.equal(state.form.values.objectRef, 'main');
        }
        const webviews = vscode.window.tabGroups.all.flatMap((group) => group.tabs)
          .filter((entry) => entry.input instanceof vscode.TabInputWebview);
        assert.deepEqual(webviews.map((entry) => entry.label), ['Git Checkout']);
      } finally {
        await ctx.api.sendPanelMessage({
          type: 'operationFormMessage', sessionId: state.sessionId, message: { type: 'formCancel' },
        });
        await pending;
      }
      assert.equal(ctx.api.operationFormState(), undefined);
      assert.ok(vscode.window.tabGroups.all.some((group) => group.tabs.includes(tab)));
      assert.deepEqual(snapshot(), before);
    });
  }
});
