import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';

import { bindExtension, git, readyTree, repoRoot, waitFor } from './harness';

import {
  answer,
  branchContext,
  cancelForm,
  commitFile,
  gitIn,
  menuContext,
  submitForm,
} from './graphMenu';

describe('Graph context menu: Branch submenu', () => {
  const ctx = bindExtension();
  let remote: string;
  let other: string;

  beforeEach(async () => {
    await readyTree(ctx.api);
    git('config', 'protocol.file.allow', 'always');
    remote = mkdtempSync(join(tmpdir(), 'git-checkout-e2e-remote-'));
    other = mkdtempSync(join(tmpdir(), 'git-checkout-e2e-other-'));
    gitIn(remote, 'init', '--bare', '-b', 'main');
    git('remote', 'add', 'origin', remote);
    commitFile('base.txt', 'base\n', 'base');
    git('push', '-u', 'origin', 'main');
    gitIn(other, 'clone', remote, '.');
    gitIn(other, 'config', 'user.name', 'other');
    gitIn(other, 'config', 'user.email', 'other@example.com');
  });

  afterEach(() => {
    rmSync(remote, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  });

  /** A commit made elsewhere and fetched, so `origin/main` is ahead of `main`. */
  function remoteAhead(message: string): string {
    writeFileSync(join(other, `${message}.txt`), `${message}\n`);
    gitIn(other, 'add', '.');
    gitIn(other, 'commit', '-m', message);
    gitIn(other, 'push', 'origin', 'main');
    git('fetch', 'origin');
    return gitIn(other, 'rev-parse', 'HEAD');
  }

  it('Checkout: the branch that was right-clicked, whichever branches share the commit', async () => {
    git('branch', 'first-topic');
    git('branch', 'second-topic');
    await vscode.commands.executeCommand('gitCheckout.graph.checkoutRef', branchContext('second-topic'));
    assert.equal(git('branch', '--show-current'), 'second-topic');
    await vscode.commands.executeCommand('gitCheckout.graph.checkoutRef', branchContext('first-topic'));
    assert.equal(git('branch', '--show-current'), 'first-topic');
  });

  it('Checkout: a remote branch', async () => {
    gitIn(other, 'push', 'origin', 'HEAD:refs/heads/remote-only');
    git('fetch', 'origin');
    await vscode.commands.executeCommand('gitCheckout.graph.checkoutRef', branchContext('origin/remote-only', 'remote'));
    await waitFor('remote branch checked out', async () =>
      git('rev-parse', 'HEAD') === git('rev-parse', 'origin/remote-only') ? true : undefined,
    );
  });

  it('Fast-Forward: brings a branch up to its upstream', async () => {
    const tip = remoteAhead('ahead');
    await vscode.commands.executeCommand('gitCheckout.graph.branch.fastForward', branchContext('main'));
    assert.equal(git('rev-parse', 'main'), tip);
  });

  it('Fast-Forward: a branch that is not checked out', async () => {
    git('branch', '--track', 'side', 'origin/main');
    gitIn(other, 'checkout', '-b', 'side');
    writeFileSync(join(other, 'side.txt'), 'side\n');
    gitIn(other, 'add', '.');
    gitIn(other, 'commit', '-m', 'side work');
    gitIn(other, 'push', 'origin', 'side');
    git('fetch', 'origin');
    git('branch', '--set-upstream-to=origin/side', 'side');
    await vscode.commands.executeCommand('gitCheckout.graph.branch.fastForward', branchContext('side'));
    assert.equal(git('rev-parse', 'side'), gitIn(other, 'rev-parse', 'HEAD'));
    assert.equal(git('branch', '--show-current'), 'main');
  });

  it('Pull…: the checked-out branch opens the Pull modal and pulls', async () => {
    const tip = remoteAhead('pulled');
    const command = vscode.commands.executeCommand('gitCheckout.graph.branch.pull', branchContext('main'));
    await submitForm(ctx.api, command, 'Pull', { remote: 'origin', branch: 'main', rebase: false, stash: false });
    assert.equal(git('rev-parse', 'main'), tip);
  });

  it('Pull…: a branch that is not checked out is brought up to its upstream', async () => {
    gitIn(other, 'checkout', '-b', 'side');
    writeFileSync(join(other, 'side.txt'), 'side\n');
    gitIn(other, 'add', '.');
    gitIn(other, 'commit', '-m', 'side work');
    gitIn(other, 'push', 'origin', 'side');
    git('fetch', 'origin');
    git('branch', '--track', 'side', 'origin/side');
    gitIn(other, 'commit', '--allow-empty', '-m', 'more side');
    gitIn(other, 'push', 'origin', 'side');
    git('fetch', 'origin');
    await vscode.commands.executeCommand('gitCheckout.graph.branch.pull', branchContext('side'));
    assert.equal(git('rev-parse', 'side'), gitIn(other, 'rev-parse', 'HEAD'));
    assert.equal(git('branch', '--show-current'), 'main');
  });

  it('Push…: opens the Push modal on that branch and pushes it', async () => {
    const sha = commitFile('pushed.txt', 'pushed\n', 'to push');
    const command = vscode.commands.executeCommand('gitCheckout.graph.branch.push', branchContext('main'));
    const state = await waitFor('Push modal', async () => ctx.api.operationFormState());
    assert.equal(state.form.values.branch, 'main');
    await submitForm(ctx.api, command, 'Push', { remote: 'origin', branch: 'main', tags: false, force: false });
    assert.equal(gitIn(remote, 'rev-parse', 'main'), sha);
  });

  it('Push…: a branch that is not checked out', async () => {
    git('branch', 'unpushed');
    const command = vscode.commands.executeCommand('gitCheckout.graph.branch.push', branchContext('unpushed'));
    const state = await waitFor('Push modal', async () => ctx.api.operationFormState());
    assert.equal(state.form.values.branch, 'unpushed');
    await submitForm(ctx.api, command, 'Push', { remote: 'origin', branch: 'unpushed', tags: false, force: false });
    assert.equal(gitIn(remote, 'rev-parse', 'unpushed'), git('rev-parse', 'unpushed'));
  });

  it('Rename…: opens the rename modal for that branch and renames it', async () => {
    git('branch', 'old-name');
    const command = vscode.commands.executeCommand('gitCheckout.graph.branch.rename', branchContext('old-name'));
    await submitForm(ctx.api, command, 'Rename Local Branch', { name: 'new-name' });
    assert.equal(git('branch', '--list', 'new-name'), 'new-name');
    assert.equal(git('branch', '--list', 'old-name'), '');
  });

  it('Delete…: opens the delete modal for that branch and deletes it', async () => {
    git('branch', 'doomed');
    const command = vscode.commands.executeCommand('gitCheckout.graph.deleteBranch', branchContext('doomed'));
    await submitForm(ctx.api, command, 'Delete Branch', { deleteRemote: false });
    assert.equal(git('branch', '--list', 'doomed'), '');
  });

  it('Delete…: a remote branch is removed from the remote', async () => {
    gitIn(other, 'push', 'origin', 'HEAD:refs/heads/remote-doomed');
    git('fetch', 'origin');
    const command = vscode.commands.executeCommand(
      'gitCheckout.graph.deleteBranch', branchContext('origin/remote-doomed', 'remote'),
    );
    await submitForm(ctx.api, command, 'Delete Branch');
    assert.equal(gitIn(remote, 'branch', '--list', 'remote-doomed'), '');
  });

  it('Copy Branch Name: copies the name of that branch', async () => {
    git('branch', 'copy-me');
    await vscode.env.clipboard.writeText('');
    await vscode.commands.executeCommand('gitCheckout.graph.branch.copyName', branchContext('copy-me'));
    assert.equal(await vscode.env.clipboard.readText(), 'copy-me');
  });
});

describe('Graph context menu: commit menu', () => {
  const ctx = bindExtension();
  let restore: (() => void)[] = [];

  beforeEach(async () => {
    await readyTree(ctx.api);
    restore = [];
  });

  afterEach(() => {
    for (const undo of restore) { undo(); }
  });

  /** Two commits on `topic` that `main` does not have. */
  function topicWork(): string[] {
    git('checkout', '-b', 'topic');
    const first = commitFile('one.txt', 'one\n', 'topic one');
    const second = commitFile('two.txt', 'two\n', 'topic two');
    git('checkout', 'main');
    return [first, second];
  }

  it('Checkout Commit…: detaches HEAD at the commit', async () => {
    const [first] = topicWork();
    await vscode.commands.executeCommand('gitCheckout.graph.checkout', menuContext(first));
    assert.equal(git('rev-parse', 'HEAD'), first);
    assert.equal(git('branch', '--show-current'), '');
  });

  it('New Branch…: opens the form at that commit and creates the branch', async () => {
    const [first] = topicWork();
    const command = vscode.commands.executeCommand('gitCheckout.graph.newBranch', menuContext(first));
    const state = await waitFor('Create Branch modal', async () => ctx.api.operationFormState());
    assert.equal(state.form.values.startPoint, first);
    await submitForm(ctx.api, command, 'Create Branch', { name: 'from-graph', checkout: false });
    assert.equal(git('rev-parse', 'from-graph'), first);
  });

  it('New Branch…: starts from the name of a tag or branch on the commit instead of its hash', async () => {
    const [first] = topicWork();
    git('tag', 'v1', first);
    const command = vscode.commands.executeCommand('gitCheckout.graph.newBranch', menuContext(first, { graphStartRef: 'v1' }));
    const state = await waitFor('Create Branch modal', async () => ctx.api.operationFormState());
    assert.equal(state.form.values.startPoint, 'v1');
    // Whitespace typed into the name is replaced with git.branchWhitespaceChar, a hyphen unless it is set.
    const name = state.form.fields.find((field) => field.id === 'name');
    assert.equal(name?.replaceWhitespace, vscode.workspace.getConfiguration('git').get('branchWhitespaceChar', '-'));
    await cancelForm(ctx.api, command, 'Create Branch');
  });

  it('New Tag…: opens the form at that commit and creates the tag', async () => {
    const [first] = topicWork();
    const command = vscode.commands.executeCommand('gitCheckout.graph.newTag', menuContext(first));
    const state = await waitFor('Create Tag modal', async () => ctx.api.operationFormState());
    assert.equal(state.form.values.objectRef, first);
    await submitForm(ctx.api, command, 'Create Tag', { name: 'graph-tag', message: 'from the graph', pushAllRemotes: false });
    assert.equal(git('rev-parse', 'graph-tag^{commit}'), first);
  });

  it('Merge into Current Branch…: opens the Merge modal for that commit and merges it', async () => {
    const [, second] = topicWork();
    const command = vscode.commands.executeCommand('gitCheckout.graph.mergeHere', menuContext(second));
    await submitForm(ctx.api, command, 'Merge');
    assert.equal(git('rev-parse', 'HEAD'), second);
  });

  it('Rebase Current Branch onto Here…: opens the Rebase modal and rebases', async () => {
    const [first] = topicWork();
    const own = commitFile('own.txt', 'own\n', 'own work');
    const command = vscode.commands.executeCommand('gitCheckout.graph.rebaseHere', menuContext(first));
    await submitForm(ctx.api, command, 'Rebase', { updateDependentBranches: false, stashAndReapply: false });
    assert.equal(git('rev-parse', 'HEAD^'), first);
    assert.notEqual(git('rev-parse', 'HEAD'), own);
  });

  it('Cherry-Pick Commit…: applies that commit to the current branch', async () => {
    const [first] = topicWork();
    restore.push(answer('showWarningMessage', async () => undefined));
    await vscode.commands.executeCommand('gitCheckout.graph.cherryPick', menuContext(first));
    assert.equal(git('log', '-1', '--format=%s'), 'topic one');
    assert.equal(git('show', 'HEAD:one.txt'), 'one');
  });

  it('Revert Commit…: adds a commit that undoes it', async () => {
    const sha = commitFile('undo.txt', 'undo me\n', 'to undo');
    restore.push(answer('showWarningMessage', async () => undefined));
    await vscode.commands.executeCommand('gitCheckout.graph.revert', menuContext(sha));
    assert.match(git('log', '-1', '--format=%s'), /^Revert "to undo"/);
    assert.equal(git('ls-files', 'undo.txt'), '');
  });

  it('Reset to Here…: resets the current branch to that commit', async () => {
    const base = git('rev-parse', 'HEAD');
    commitFile('later.txt', 'later\n', 'later');
    const command = vscode.commands.executeCommand('gitCheckout.graph.reset', menuContext(base));
    await submitForm(ctx.api, command, 'Reset Current Branch to Revision', { mode: 'hard' });
    assert.equal(git('rev-parse', 'HEAD'), base);
    assert.equal(git('ls-files', 'later.txt'), '');
  });

  it('Copy Commit SHA, Copy Subject and Copy as Patch: put the right text on the clipboard', async () => {
    const sha = commitFile('patch.txt', 'patch\n', 'for the clipboard');
    await vscode.commands.executeCommand('gitCheckout.graph.copyHash', menuContext(sha));
    assert.equal(await vscode.env.clipboard.readText(), sha);
    await vscode.commands.executeCommand('gitCheckout.graph.copySubject', menuContext(sha));
    assert.equal(await vscode.env.clipboard.readText(), 'for the clipboard');
    await vscode.commands.executeCommand('gitCheckout.graph.copyPatch', menuContext(sha));
    const patch = await vscode.env.clipboard.readText();
    assert.match(patch, new RegExp(`^From ${sha}`));
    assert.match(patch, /\+\+\+ b\/patch\.txt/);
  });

  it('Open Pull Request on GitHub…: says so when the repository is not on GitHub', async () => {
    const messages: string[] = [];
    restore.push(answer('showWarningMessage', async (message: unknown) => { messages.push(String(message)); return undefined; }));
    await vscode.commands.executeCommand('gitCheckout.sidebar.openPullRequest', { ref: 'main' });
    assert.deepEqual(messages, ['This repository has no GitHub remote.']);
  });

  it('Create Archive…: writes the commit as a zip the person chose', async () => {
    const sha = commitFile('archived.txt', 'archived\n', 'for the archive');
    const target = join(mkdtempSync(join(tmpdir(), 'git-checkout-e2e-archive-')), 'snapshot.zip');
    restore.push(answer('showSaveDialog', async () => vscode.Uri.file(target)));
    await vscode.commands.executeCommand('gitCheckout.graph.archive', menuContext(sha));
    await waitFor('archive file', async () => (existsSync(target) && statSync(target).size > 0 ? true : undefined));
    assert.match(execFileSync('unzip', ['-l', target], { encoding: 'utf8' }), /archived\.txt/);
  });

  it('Save as Patch…: writes the commit to the chosen file', async () => {
    const sha = commitFile('saved.txt', 'saved\n', 'save me');
    const target = join(mkdtempSync(join(tmpdir(), 'git-checkout-e2e-patch-')), 'one.patch');
    restore.push(answer('showSaveDialog', async () => vscode.Uri.file(target)));
    const command = vscode.commands.executeCommand('gitCheckout.graph.savePatch', menuContext(sha));
    await submitForm(ctx.api, command, 'Create Patch');
    await waitFor('patch file', async () =>
      execFileSync('cat', [target], { encoding: 'utf8' }).includes('save me') ? true : undefined,
    );
  });

  it('Cherry-Pick Commits: applies every selected commit', async () => {
    const [first, second] = topicWork();
    const warnings: unknown[] = [];
    restore.push(
      answer('showWarningMessage', async (message: unknown) => { warnings.push(message); return undefined; }),
      answer('showErrorMessage', async (message: unknown) => { warnings.push(message); return undefined; }),
    );
    await vscode.commands.executeCommand('gitCheckout.graph.cherryPickRange', {
      ...menuContext(second), graphSelection: 'multi', shas: [second, first],
    });
    assert.equal(git('log', '--format=%s', '-3'), 'topic two\ntopic one\ninit', JSON.stringify(warnings));
    assert.equal(git('show', 'HEAD:one.txt'), 'one');
    assert.equal(git('show', 'HEAD:two.txt'), 'two');
  });

  it('Squash Commits and Drop Commits: rewrite the selected commits', async () => {
    commitFile('a.txt', 'a\n', 'commit a');
    const b = commitFile('b.txt', 'b\n', 'commit b');
    const a = git('rev-parse', 'HEAD^');
    restore.push(
      answer('showInputBox', async () => 'squashed a and b'),
      answer('showWarningMessage', async (_message: unknown, _options: unknown, ...actions: unknown[]) => actions[0]),
    );
    await vscode.commands.executeCommand('gitCheckout.graph.squash', {
      ...menuContext(b), graphSelection: 'multi', shas: [b, a],
    });
    assert.equal(git('log', '-1', '--format=%s'), 'squashed a and b');
    assert.equal(git('rev-list', '--count', 'HEAD'), '2');

    const top = git('rev-parse', 'HEAD');
    const c = commitFile('c.txt', 'c\n', 'commit c');
    const d = commitFile('d.txt', 'd\n', 'commit d');
    await vscode.commands.executeCommand('gitCheckout.graph.drop', {
      ...menuContext(d), graphSelection: 'multi', shas: [d, c],
    });
    assert.equal(git('rev-parse', 'HEAD'), top);
  });

  it('Copy Hashes and Copy Patches: copy every selected commit', async () => {
    const first = commitFile('x.txt', 'x\n', 'commit x');
    const second = commitFile('y.txt', 'y\n', 'commit y');
    const multi = { ...menuContext(second), graphSelection: 'multi', shas: [second, first] };
    await vscode.commands.executeCommand('gitCheckout.graph.copyHashes', multi);
    assert.equal(await vscode.env.clipboard.readText(), `${second}\n${first}`);
    await vscode.commands.executeCommand('gitCheckout.graph.copyPatches', multi);
    const patches = await vscode.env.clipboard.readText();
    assert.ok(patches.includes('commit x') && patches.includes('commit y'));
  });

  it('Apply, Pop and Drop Stash: act on the stash entry that was right-clicked', async () => {
    writeFileSync(join(repoRoot(), 'stashed.txt'), 'stashed\n');
    git('add', 'stashed.txt');
    git('stash', 'push', '-m', 'graph stash');
    const stashSha = git('rev-parse', 'stash@{0}');
    const stash = { ...menuContext(stashSha), stashSelector: 'stash@{0}' };
    restore.push(answer('showWarningMessage', async (_message: unknown, _options: unknown, ...actions: unknown[]) => actions[0]));

    const apply = vscode.commands.executeCommand('gitCheckout.graph.stashApply', stash);
    await submitForm(ctx.api, apply, 'Apply Stash', { deleteAfter: false });
    assert.equal(git('ls-files', 'stashed.txt'), 'stashed.txt');
    assert.equal(git('stash', 'list').split('\n').length, 1);

    git('reset', '--hard');
    git('clean', '-fd');
    await vscode.commands.executeCommand('gitCheckout.graph.stashPop', stash);
    assert.equal(git('stash', 'list'), '');
    assert.equal(git('ls-files', 'stashed.txt'), 'stashed.txt');

    git('reset', '--hard');
    writeFileSync(join(repoRoot(), 'again.txt'), 'again\n');
    git('add', 'again.txt');
    git('stash', 'push', '-m', 'to drop');
    const drop = vscode.commands.executeCommand('gitCheckout.graph.stashDrop', { ...stash, stashSelector: 'stash@{0}' });
    await submitForm(ctx.api, drop, 'Drop Stash');
    assert.equal(git('stash', 'list'), '');
  });
});
