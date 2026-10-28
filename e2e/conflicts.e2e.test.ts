import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';

import { answer, commitFile, menuContext, submitForm } from './graphMenu';
import { bindExtension, git, readyTree, repoRoot, waitFor } from './harness';

describe('Operation banner', () => {
  const ctx = bindExtension();
  let restore: (() => void)[] = [];
  let toasts: string[] = [];

  beforeEach(async () => {
    await readyTree(ctx.api);
    restore = [];
    toasts = [];
    restore.push(
      answer('showInformationMessage', async (message: unknown) => { toasts.push(String(message)); return undefined; }),
      // A native warning here is a confirmation ("Merge may conflict… Continue?"): take its first button.
      answer('showWarningMessage', async (_message: unknown, _options: unknown, ...actions: unknown[]) => actions[0]),
    );
  });

  afterEach(async () => {
    for (const undo of restore) { undo(); }
    // The merge editors the tests opened would otherwise stay open on files the next test rewrites.
    await vscode.window.tabGroups.close(vscode.window.tabGroups.all.flatMap((group) => group.tabs));
    await waitFor('the editors to close', async () =>
      vscode.window.tabGroups.all.every((group) => group.tabs.length === 0) ? true : undefined,
    );
  });

  const gitDir = (name: string): string => join(repoRoot(), '.git', name);

  /** `topic` and `main` each change the same line of `file` in their own way. */
  function divergingEdits(file = 'c.txt'): { base: string; topic: string; main: string } {
    const base = commitFile(file, 'one\nbase\nthree\n', 'base');
    git('checkout', '-b', 'topic');
    const topic = commitFile(file, 'one\ntopic\nthree\n', 'topic edit');
    git('checkout', 'main');
    const main = commitFile(file, 'one\nmain\nthree\n', 'main edit');
    return { base, topic, main };
  }

  /** The banner above the graph, once it shows `title`. */
  async function banner(title: RegExp) {
    return waitFor(`the banner "${title}"`, async () => {
      const model = await ctx.api.operationBanner();
      return model && title.test(model.title) ? model : undefined;
    });
  }

  /** The banner after every conflict is fixed and staged: only Continue is left to do. */
  async function bannerReadyToContinue() {
    return waitFor('the banner to offer Continue', async () => {
      const model = await ctx.api.operationBanner();
      return model?.primary === 'continue' ? model : undefined;
    });
  }

  async function bannerGone(): Promise<void> {
    await waitFor('the banner to go away', async () => ((await ctx.api.operationBanner()) ? undefined : true));
  }

  async function toast(pattern: RegExp): Promise<void> {
    await waitFor(`a notification matching ${pattern}`, async () =>
      toasts.some((message) => pattern.test(message)) ? true : undefined,
    );
  }

  async function mergeTopicIntoMain(topic: string): Promise<void> {
    const command = vscode.commands.executeCommand('gitCheckout.graph.mergeHere', menuContext(topic));
    await submitForm(ctx.api, command, 'Merge');
  }

  const write = (name: string, bytes: number[]): void => {
    writeFileSync(join(repoRoot(), name), Buffer.from(bytes));
    git('add', name);
  };

  /** A merge of `topic` into `main` where `gone.txt` was deleted on `main` and changed on `topic`. */
  async function mergeWithDeletedFile(): Promise<void> {
    commitFile('gone.txt', 'keep?\n', 'base');
    git('checkout', '-b', 'topic');
    const topic = commitFile('gone.txt', 'changed on topic\n', 'topic edit');
    git('checkout', 'main');
    git('rm', 'gone.txt');
    git('commit', '-m', 'main deletes it');
    await mergeTopicIntoMain(topic);
  }

  /** A merge of `topic` into `main` where both changed `image.bin`. */
  async function mergeWithBinaryFile(): Promise<void> {
    write('image.bin', [0, 1, 2, 3]);
    git('commit', '-m', 'base');
    git('checkout', '-b', 'topic');
    write('image.bin', [0, 9, 9, 9]);
    git('commit', '-m', 'topic binary');
    const topic = git('rev-parse', 'HEAD');
    git('checkout', 'main');
    write('image.bin', [0, 7, 7, 7]);
    git('commit', '-m', 'main binary');
    await mergeTopicIntoMain(topic);
  }

  const mergeCommitCount = (): number => git('rev-list', '--parents', '-n', '1', 'HEAD').split(' ').length;
  const mergeDone = (): Promise<boolean | undefined> =>
    waitFor('the merge commit', async () => (mergeCommitCount() === 3 ? true : undefined));

  describe('merge', () => {
    it('stays above the graph while the merge waits for the conflict to be fixed', async () => {
      const { topic } = divergingEdits();
      await mergeTopicIntoMain(topic);

      assert.match(git('status', '--porcelain'), /^UU c\.txt$/m);
      assert.equal(git('rev-parse', 'MERGE_HEAD'), topic);
      await toast(/Merge in progress · 1 conflicted file/);

      const model = await banner(/^Merging/);
      assert.equal(model.title, `Merging '${topic.slice(0, 7)}'`);
      assert.equal(model.message, 'Fix 1 conflict and then continue.');
      assert.equal(model.primary, 'resolve');
      assert.equal(model.canAbort, true);
    });

    it('lists the conflicted file in the Unstaged list', async () => {
      const { topic } = divergingEdits();
      await mergeTopicIntoMain(topic);
      const paths = async (): Promise<string[]> =>
        ((await ctx.api.changesLists.unstaged.getChildren()) as { path?: string }[]).map((node) => node.path ?? '');
      await banner(/^Merging/);
      await ctx.api.sendPanelMessage({ type: 'workingCopyReady' });
      await waitFor('the conflicted file in Unstaged', async () => ((await paths()).includes('c.txt') ? true : undefined));
      const [row] = (await ctx.api.changesLists.unstaged.getChildren()) as unknown as { path: string; status: string }[];
      assert.equal(row.path, 'c.txt');
      assert.equal(row.status, 'conflict');
    });

    it('opens the conflicted file in the merge editor from Resolve', async () => {
      const { topic } = divergingEdits();
      await mergeTopicIntoMain(topic);
      await banner(/^Merging/);

      await ctx.api.sendPanelMessage({ type: 'operationResolve' });
      await waitFor('the merge editor to open c.txt', async () =>
        vscode.window.tabGroups.all.flatMap((group) => group.tabs).some((tab) => /c\.txt/.test(tab.label)) ? true : undefined,
      );
    });

    it('opens the merge editor when a conflicted file is picked in the Changes tab, as well as previewing it', async () => {
      const { topic } = divergingEdits();
      await mergeTopicIntoMain(topic);
      await banner(/^Merging/);
      await ctx.api.sendPanelMessage({ type: 'workingCopyReady' });

      await ctx.api.sendPanelMessage({ type: 'changesSelect', path: 'c.txt', side: 'unstaged' });
      await waitFor('the merge editor to open c.txt', async () =>
        vscode.window.tabGroups.all.flatMap((group) => group.tabs).some((tab) => /c\.txt/.test(tab.label)) ? true : undefined,
      );
    });

    it('offers Continue once the file is resolved and staged, and finishes with a merge commit', async () => {
      const { topic, main } = divergingEdits();
      await mergeTopicIntoMain(topic);
      await banner(/^Merging/);

      writeFileSync(join(repoRoot(), 'c.txt'), 'one\nboth\nthree\n');
      git('add', 'c.txt');
      const ready = await bannerReadyToContinue();
      assert.equal(ready.message, 'All conflicts are resolved. Continue to finish.');

      await ctx.api.sendPanelMessage({ type: 'operationContinue' });
      await mergeDone();
      assert.deepEqual(git('rev-list', '--parents', '-n', '1', 'HEAD').split(' ').slice(1), [main, topic]);
      assert.equal(git('show', 'HEAD:c.txt'), 'one\nboth\nthree');
      assert.equal(git('status', '--porcelain'), '');
      assert.equal(existsSync(gitDir('MERGE_HEAD')), false);
      await bannerGone();
    });

    it('goes back to how things were when the merge is aborted', async () => {
      const { main, topic } = divergingEdits();
      await mergeTopicIntoMain(topic);
      await banner(/^Merging/);

      await ctx.api.sendPanelMessage({ type: 'operationAbort' });
      await waitFor('the merge to be aborted', async () => (existsSync(gitDir('MERGE_HEAD')) ? undefined : true));
      assert.equal(git('rev-parse', 'HEAD'), main);
      assert.equal(git('status', '--porcelain'), '');
      assert.equal(git('show', 'HEAD:c.txt'), 'one\nmain\nthree');
      await bannerGone();
    });

    it('keeps the merge going when the abort is not confirmed', async () => {
      const { topic } = divergingEdits();
      await mergeTopicIntoMain(topic);
      await banner(/^Merging/);

      restore.push(answer('showWarningMessage', async () => undefined));
      await ctx.api.sendPanelMessage({ type: 'operationAbort' });
      assert.equal(existsSync(gitDir('MERGE_HEAD')), true);
      assert.ok(await ctx.api.operationBanner());
    });

    it('explains a file deleted on one side and changed on the other, which the merge editor cannot show', async () => {
      await mergeWithDeletedFile();
      await banner(/^Merging/);

      await ctx.api.sendPanelMessage({ type: 'operationResolve' });
      await toast(/git rm/);
      assert.ok(toasts.some((message) => /git add/.test(message)));
    });

    it('finishes after the deletion is kept, as the guidance says to do', async () => {
      await mergeWithDeletedFile();
      await banner(/^Merging/);

      git('rm', 'gone.txt'); // "keep the deletion with `git rm gone.txt`"
      await bannerReadyToContinue();
      await ctx.api.sendPanelMessage({ type: 'operationContinue' });
      await mergeDone();
      assert.equal(git('ls-files', 'gone.txt'), '');
      assert.equal(git('status', '--porcelain'), '');
    });

    it('finishes after the changed version is kept, as the guidance says to do', async () => {
      await mergeWithDeletedFile();
      await banner(/^Merging/);

      git('add', 'gone.txt'); // "keep the file with `git add gone.txt`"
      await ctx.api.sendPanelMessage({ type: 'operationContinue' });
      await mergeDone();
      assert.equal(git('show', 'HEAD:gone.txt'), 'changed on topic');
    });

    it('explains a binary file with the commands that choose a side', async () => {
      await mergeWithBinaryFile();
      await banner(/^Merging/);

      await ctx.api.sendPanelMessage({ type: 'operationResolve' });
      await toast(/--theirs/);
      assert.ok(toasts.some((message) => /--ours/.test(message)));
    });

    it('finishes after one side of a binary file is chosen, as the guidance says to do', async () => {
      await mergeWithBinaryFile();
      await banner(/^Merging/);

      git('checkout', '--theirs', 'image.bin'); // "choose a version with `git checkout --theirs image.bin`"
      git('add', 'image.bin');
      await ctx.api.sendPanelMessage({ type: 'operationContinue' });
      await mergeDone();
      assert.deepEqual([...readFileSync(join(repoRoot(), 'image.bin'))], [0, 9, 9, 9]);
      assert.equal(git('status', '--porcelain'), '');
    });

    it('explains a submodule pointer conflict and finishes after the intended commit is staged', async () => {
      const lib = join(repoRoot(), '..', `${repoRoot().split('/').pop()}-lib`);
      const env = { ...process.env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'protocol.file.allow', GIT_CONFIG_VALUE_0: 'always' };
      const inLib = (...args: string[]): string => execFileSync('git', args, { cwd: lib, env, encoding: 'utf8' }).trim();
      restore.push(() => rmSync(lib, { recursive: true, force: true }));
      mkdirSync(lib);
      inLib('init', '-q', '-b', 'main');
      inLib('config', 'user.email', 'test@git-checkout.local');
      inLib('config', 'user.name', 'git-checkout-test');
      writeFileSync(join(lib, 'f'), '1\n');
      inLib('add', 'f');
      inLib('commit', '-qm', 'one');
      inLib('checkout', '-qb', 'left');
      writeFileSync(join(lib, 'f'), '2\n');
      inLib('commit', '-qam', 'left');
      inLib('checkout', '-q', 'main');
      inLib('checkout', '-qb', 'right');
      writeFileSync(join(lib, 'g'), '3\n');
      inLib('add', 'g');
      inLib('commit', '-qm', 'right');
      const left = inLib('rev-parse', 'left');

      const app = (...args: string[]): string => execFileSync('git', args, { cwd: repoRoot(), env, encoding: 'utf8' }).trim();
      app('-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', lib, 'lib');
      app('-C', 'lib', 'checkout', '-q', 'main');
      app('commit', '-qam', 'add submodule');
      app('checkout', '-qb', 'topic');
      app('-C', 'lib', 'checkout', '-q', 'left');
      app('commit', '-qam', 'topic moves lib');
      const topic = app('rev-parse', 'HEAD');
      app('checkout', '-q', 'main');
      app('-C', 'lib', 'checkout', '-q', 'right');
      app('commit', '-qam', 'main moves lib');
      await mergeTopicIntoMain(topic);

      assert.equal((await banner(/^Merging/)).message, 'Fix 1 conflict and then continue.');
      await ctx.api.sendPanelMessage({ type: 'operationResolve' });
      await toast(/Submodule conflict in "lib"/);

      // "Checkout the intended commit inside the submodule, then run `git add lib`."
      app('-C', 'lib', 'checkout', '-q', left);
      app('add', 'lib');
      await bannerReadyToContinue();
      await ctx.api.sendPanelMessage({ type: 'operationContinue' });
      await mergeDone();
      assert.equal(app('ls-tree', 'HEAD', 'lib').split(/\s+/)[2], left);
    });

    it('counts several conflicted files and drops the count as each one is resolved', async () => {
      commitFile('a.txt', 'a\nbase\n', 'base a');
      commitFile('b.txt', 'b\nbase\n', 'base b');
      git('checkout', '-b', 'topic');
      writeFileSync(join(repoRoot(), 'a.txt'), 'a\ntopic\n');
      writeFileSync(join(repoRoot(), 'b.txt'), 'b\ntopic\n');
      git('commit', '-am', 'topic edits');
      const topic = git('rev-parse', 'HEAD');
      git('checkout', 'main');
      writeFileSync(join(repoRoot(), 'a.txt'), 'a\nmain\n');
      writeFileSync(join(repoRoot(), 'b.txt'), 'b\nmain\n');
      git('commit', '-am', 'main edits');
      await mergeTopicIntoMain(topic);
      await toast(/2 conflicted files/);

      assert.equal((await banner(/^Merging/)).message, 'Fix 2 conflicts and then continue.');

      writeFileSync(join(repoRoot(), 'a.txt'), 'a\nboth\n');
      git('add', 'a.txt');
      await waitFor('one conflict left', async () =>
        (await ctx.api.operationBanner())?.message === 'Fix 1 conflict and then continue.' ? true : undefined,
      );
    });
  });

  describe('rebase', () => {
    /** On `topic`, rebasing onto `main`, whose edit of the same line conflicts. */
    async function startConflictingRebase(): Promise<{ topic: string; main: string }> {
      const { topic, main } = divergingEdits();
      git('checkout', 'topic');
      const command = vscode.commands.executeCommand('gitCheckout.graph.rebaseHere', menuContext(main));
      await submitForm(ctx.api, command, 'Rebase', { updateDependentBranches: false, stashAndReapply: false });
      return { topic, main };
    }

    it('says which branch is moving onto what, how far it got, and which commit conflicts', async () => {
      const { topic, main } = await startConflictingRebase();
      assert.match(git('status', '--porcelain'), /^UU c\.txt$/m);
      await toast(/Rebase in progress · 1 conflicted file/);

      const model = await banner(/^Rebasing/);
      assert.equal(model.title, `Rebasing 'topic' → '${main.slice(0, 7)}' (rebased 0/1 commits)`);
      assert.equal(model.message, `Fix 1 conflict with '${topic.slice(0, 7)}' and then continue.`);
      assert.equal(model.progress, 0);
      assert.equal(model.primary, 'resolve');
    });

    it('puts the branch on top of the target once the conflict is resolved and the rebase continued', async () => {
      const { main } = await startConflictingRebase();
      await banner(/^Rebasing/);

      writeFileSync(join(repoRoot(), 'c.txt'), 'one\nboth\nthree\n');
      git('add', 'c.txt');
      await bannerReadyToContinue();
      await ctx.api.sendPanelMessage({ type: 'operationContinue' });
      await waitFor('the rebase to finish', async () => (existsSync(gitDir('rebase-merge')) ? undefined : true));
      assert.equal(git('branch', '--show-current'), 'topic');
      assert.equal(git('rev-parse', 'HEAD^'), main);
      assert.equal(git('log', '-1', '--format=%s'), 'topic edit');
      assert.equal(git('show', 'HEAD:c.txt'), 'one\nboth\nthree');
      await bannerGone();
    });

    it('restores the branch when the rebase is aborted after its conflict was resolved', async () => {
      const { topic } = await startConflictingRebase();
      await banner(/^Rebasing/);
      writeFileSync(join(repoRoot(), 'c.txt'), 'one\nboth\nthree\n');
      git('add', 'c.txt');
      await bannerReadyToContinue();

      await ctx.api.sendPanelMessage({ type: 'operationAbort' });
      await waitFor('the rebase to be aborted', async () => (existsSync(gitDir('rebase-merge')) ? undefined : true));
      assert.equal(git('rev-parse', 'HEAD'), topic);
      assert.equal(git('status', '--porcelain'), '');
      await bannerGone();
    });

    it('restores the branch to where it was when the rebase is aborted', async () => {
      const { topic } = await startConflictingRebase();
      await banner(/^Rebasing/);

      await ctx.api.sendPanelMessage({ type: 'operationAbort' });
      await waitFor('the rebase to be aborted', async () => (existsSync(gitDir('rebase-merge')) ? undefined : true));
      assert.equal(git('branch', '--show-current'), 'topic');
      assert.equal(git('rev-parse', 'HEAD'), topic);
      assert.equal(git('status', '--porcelain'), '');
      await bannerGone();
    });

    /** `topic` has `t1` and `t2`, which each change a file that `main` changed too, and `t3`, which does not. */
    async function startRebaseWithTwoConflicts(): Promise<{ topic: string; main: string; t2: string }> {
      commitFile('a.txt', 'base\n', 'base a');
      commitFile('b.txt', 'base\n', 'base b');
      git('checkout', '-b', 'topic');
      commitFile('a.txt', 't1\n', 't1');
      const t2 = commitFile('b.txt', 't2\n', 't2');
      const topic = commitFile('c.txt', 't3\n', 't3');
      git('checkout', 'main');
      commitFile('a.txt', 'm1\n', 'm1');
      const main = commitFile('b.txt', 'm2\n', 'm2');
      git('checkout', 'topic');
      const command = vscode.commands.executeCommand('gitCheckout.graph.rebaseHere', menuContext(main));
      await submitForm(ctx.api, command, 'Rebase', { updateDependentBranches: false, stashAndReapply: false });
      return { topic, main, t2 };
    }

    it('moves the banner on to the next commit when continuing runs into another conflict', async () => {
      const { main, t2 } = await startRebaseWithTwoConflicts();
      const first = await banner(/^Rebasing/);
      assert.equal(first.title, `Rebasing 'topic' → '${main.slice(0, 7)}' (rebased 0/3 commits)`);
      assert.equal(first.progress, 0);

      writeFileSync(join(repoRoot(), 'a.txt'), 'both\n');
      git('add', 'a.txt');
      await bannerReadyToContinue();
      await ctx.api.sendPanelMessage({ type: 'operationContinue' });

      await toast(/Stopped at the next commit, which has conflicts/);
      const second = await waitFor('the banner to reach the second commit', async () => {
        const model = await ctx.api.operationBanner();
        return model?.primary === 'resolve' && /rebased 1\/3/.test(model.title) ? model : undefined;
      });
      assert.equal(second.message, `Fix 1 conflict with '${t2.slice(0, 7)}' and then continue.`);
      assert.ok(Math.abs((second.progress ?? 0) - 1 / 3) < 1e-9);
      // The first commit is already in place: continuing did not lose or redo it.
      assert.equal(git('log', '-1', '--format=%s', 'HEAD'), 't1');
      assert.equal(git('rev-parse', 'HEAD^'), main);
      assert.match(git('status', '--porcelain'), /^UU b\.txt$/m);
    });

    it('finishes the whole rebase after each of the conflicts is fixed in turn', async () => {
      const { main } = await startRebaseWithTwoConflicts();
      await banner(/^Rebasing/);

      writeFileSync(join(repoRoot(), 'a.txt'), 'both\n');
      git('add', 'a.txt');
      await bannerReadyToContinue();
      await ctx.api.sendPanelMessage({ type: 'operationContinue' });
      await waitFor('the second conflict', async () => ((await ctx.api.operationBanner())?.primary === 'resolve' ? true : undefined));

      writeFileSync(join(repoRoot(), 'b.txt'), 'both\n');
      git('add', 'b.txt');
      await bannerReadyToContinue();
      await ctx.api.sendPanelMessage({ type: 'operationContinue' });
      await waitFor('the rebase to finish', async () => (existsSync(gitDir('rebase-merge')) ? undefined : true));
      await bannerGone();

      assert.equal(git('branch', '--show-current'), 'topic');
      assert.deepEqual(git('log', '--format=%s', `${main}..HEAD`).split('\n'), ['t3', 't2', 't1']);
      assert.equal(git('show', 'HEAD:a.txt'), 'both');
      assert.equal(git('show', 'HEAD:b.txt'), 'both');
      assert.equal(git('status', '--porcelain'), '');
    });

    it('does not continue while a conflict is left, and keeps the rebase where it is', async () => {
      const { topic } = await startRebaseWithTwoConflicts();
      await banner(/^Rebasing/);

      await ctx.api.sendPanelMessage({ type: 'operationContinue' });
      await toast(/Fix the remaining conflicts/);
      const model = await ctx.api.operationBanner();
      assert.match(model?.title ?? '', /rebased 0\/3/);
      assert.equal(model?.primary, 'resolve');
      assert.match(git('status', '--porcelain'), /^UU a\.txt$/m);

      await ctx.api.sendPanelMessage({ type: 'operationAbort' });
      await waitFor('the rebase to be aborted', async () => (existsSync(gitDir('rebase-merge')) ? undefined : true));
      assert.equal(git('rev-parse', 'HEAD'), topic);
    });
  });

  describe('cherry-pick', () => {
    it('stops on the conflict, and aborting returns to the branch as it was', async () => {
      const { topic, main } = divergingEdits();
      await vscode.commands.executeCommand('gitCheckout.graph.cherryPick', menuContext(topic));
      assert.match(git('status', '--porcelain'), /^UU c\.txt$/m);
      await toast(/Cherry-pick in progress · 1 conflicted file/);

      const model = await banner(/^Cherry-picking/);
      assert.equal(model.title, `Cherry-picking '${topic.slice(0, 7)}'`);

      await ctx.api.sendPanelMessage({ type: 'operationAbort' });
      await waitFor('the cherry-pick to be aborted', async () =>
        existsSync(gitDir('CHERRY_PICK_HEAD')) ? undefined : true,
      );
      assert.equal(git('rev-parse', 'HEAD'), main);
      assert.equal(git('status', '--porcelain'), '');
      await bannerGone();
    });

    it('commits the pick once the conflict is resolved', async () => {
      const { topic } = divergingEdits();
      await vscode.commands.executeCommand('gitCheckout.graph.cherryPick', menuContext(topic));
      await banner(/^Cherry-picking/);

      writeFileSync(join(repoRoot(), 'c.txt'), 'one\nboth\nthree\n');
      git('add', 'c.txt');
      await bannerReadyToContinue();
      await ctx.api.sendPanelMessage({ type: 'operationContinue' });
      await waitFor('the cherry-pick to finish', async () =>
        existsSync(gitDir('CHERRY_PICK_HEAD')) ? undefined : true,
      );
      assert.equal(git('log', '-1', '--format=%s'), 'topic edit');
      assert.equal(git('show', 'HEAD:c.txt'), 'one\nboth\nthree');
    });
  });

  describe('revert', () => {
    it('adds the revert commit once the conflict is resolved', async () => {
      commitFile('c.txt', 'one\nbase\nthree\n', 'base');
      const first = commitFile('c.txt', 'one\nfirst\nthree\n', 'first edit');
      commitFile('c.txt', 'one\nsecond\nthree\n', 'second edit');
      await vscode.commands.executeCommand('gitCheckout.graph.revert', menuContext(first));
      await banner(/^Reverting/);

      // Not simply what the branch already has, which would make the revert an empty commit.
      writeFileSync(join(repoRoot(), 'c.txt'), 'one\nbase and second\nthree\n');
      git('add', 'c.txt');
      await bannerReadyToContinue();
      await ctx.api.sendPanelMessage({ type: 'operationContinue' });
      await waitFor('the revert to finish', async () => (existsSync(gitDir('REVERT_HEAD')) ? undefined : true));
      assert.match(git('log', '-1', '--format=%s'), /^Revert "first edit"/);
      assert.equal(git('status', '--porcelain'), '');
    });

    it('stops on the conflict, and aborting returns to the branch as it was', async () => {
      commitFile('c.txt', 'one\nbase\nthree\n', 'base');
      const first = commitFile('c.txt', 'one\nfirst\nthree\n', 'first edit');
      const second = commitFile('c.txt', 'one\nsecond\nthree\n', 'second edit');
      // Undoing the first edit no longer applies cleanly, because the second changed the same line.
      await vscode.commands.executeCommand('gitCheckout.graph.revert', menuContext(first));
      assert.match(git('status', '--porcelain'), /^UU c\.txt$/m);
      await toast(/Revert in progress · 1 conflicted file/);

      const model = await banner(/^Reverting/);
      assert.equal(model.title, `Reverting '${first.slice(0, 7)}'`);

      await ctx.api.sendPanelMessage({ type: 'operationAbort' });
      await waitFor('the revert to be aborted', async () => (existsSync(gitDir('REVERT_HEAD')) ? undefined : true));
      assert.equal(git('rev-parse', 'HEAD'), second);
      assert.equal(git('status', '--porcelain'), '');
    });
  });

  describe('with nothing in progress', () => {
    it('shows no banner', async () => {
      assert.equal(await ctx.api.operationBanner(), undefined);
    });
  });
});
