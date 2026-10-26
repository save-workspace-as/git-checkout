import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';

import {
  assertCommands,
  bindExtension,
  git,
  readyRef,
  repoRoot,
  waitFor,
  waitForGitCheckoutPanel,
} from './harness';

function graphCommitContext(sha: string, subject: string) {
  return {
    webviewSection: 'commit' as const,
    graphSelection: 'single' as const,
    sha,
    subject,
    shas: [sha],
    preventDefaultContextMenuItems: true as const,
  };
}

describe('Git Checkout interactive rebase', () => {
  const ctx = bindExtension();

  it('registers interactive rebase commands from the manifest', async () => {
    await assertCommands(ctx.extension, [
      'gitCheckout.interactiveRebase',
      'gitCheckout.graph.interactiveRebase',
    ]);
  });

  it('drops a commit opened from the graph interactive rebase command', async () => {
    git('commit', '--allow-empty', '-m', 'drop-me');
    const dropSha = git('rev-parse', 'HEAD');
    const ontoSha = git('rev-parse', 'HEAD^');

    await vscode.commands.executeCommand(
      'gitCheckout.sidebar.revealInGraph',
      await readyRef(ctx.api, 'main'),
    );
    await waitForGitCheckoutPanel();

    await vscode.commands.executeCommand(
      'gitCheckout.graph.interactiveRebase',
      graphCommitContext(ontoSha, 'init'),
    );

    await ctx.api.sendPanelMessage({
      type: 'rebaseSetCommand',
      hash: dropSha,
      command: 'drop',
    });

    await ctx.api.sendPanelMessage({ type: 'rebaseRefresh' });
    await ctx.api.sendPanelMessage({ type: 'rebaseStart' });

    await waitFor(
      'rebase to drop the commit',
      async () => {
        const log = git('log', '--oneline');
        return !log.includes('drop-me') && git('rev-parse', 'HEAD') === ontoSha ? true : undefined;
      },
      30_000,
      () => git('log', '--oneline'),
    );
  });

  it('applies consecutive modal moves without waiting for host acknowledgements', async () => {
    git('commit', '--allow-empty', '-m', 'first');
    git('commit', '--allow-empty', '-m', 'second');
    git('commit', '--allow-empty', '-m', 'third');
    const onto = git('rev-parse', 'HEAD~3');
    await vscode.commands.executeCommand(
      'gitCheckout.sidebar.revealInGraph', await readyRef(ctx.api, 'main'),
    );
    await waitForGitCheckoutPanel();
    await vscode.commands.executeCommand(
      'gitCheckout.graph.interactiveRebase', graphCommitContext(onto, 'init'),
    );
    await Promise.all([
      ctx.api.sendPanelMessage({ type: 'rebaseReorder', fromIndex: 0, toIndex: 1, reorderId: 1 }),
      ctx.api.sendPanelMessage({ type: 'rebaseReorder', fromIndex: 1, toIndex: 2, reorderId: 2 }),
      ctx.api.sendPanelMessage({ type: 'rebaseReorder', fromIndex: 2, toIndex: 1, reorderId: 3 }),
    ]);
    await ctx.api.sendPanelMessage({ type: 'rebaseStart' });
    await waitFor('reordered commits applied', async () =>
      git('log', '-3', '--format=%s') === 'third\nfirst\nsecond' ? true : undefined);
  });

  it('rewords a commit using the message supplied by the modal', async () => {
    git('commit', '--allow-empty', '-m', 'original subject', '-m', 'original body');
    const sha = git('rev-parse', 'HEAD');
    const onto = git('rev-parse', 'HEAD^');
    await vscode.commands.executeCommand(
      'gitCheckout.sidebar.revealInGraph', await readyRef(ctx.api, 'main'),
    );
    await waitForGitCheckoutPanel();
    await vscode.commands.executeCommand(
      'gitCheckout.graph.interactiveRebase', graphCommitContext(onto, 'init'),
    );
    await ctx.api.sendPanelMessage({ type: 'rebaseEditMessage', hash: sha });
    await ctx.api.sendPanelMessage({ type: 'rebaseRequestCommitDetails', hash: sha });
    await ctx.api.sendPanelMessage({
      type: 'rebaseSetMessage', hash: sha, message: 'Updated subject\n\nUpdated body from modal',
    });

    await ctx.api.sendPanelMessage({ type: 'rebaseSetCommand', hash: sha, command: 'reword' });
    await ctx.api.sendPanelMessage({ type: 'rebaseStart' });
    await waitFor('inline reword applied', async () =>
      git('log', '-1', '--format=%B') === 'Updated subject\n\nUpdated body from modal' ? true : undefined);
    assert.notEqual(git('rev-parse', 'HEAD'), sha);
  });

  it('folds a fixup chain into the older target and discards fixup messages', async () => {
    git('commit', '--allow-empty', '-m', 'older-target', '-m', 'Retained target body');
    git('commit', '--allow-empty', '-m', 'middle-fold', '-m', 'Discard middle body');
    const middle = git('rev-parse', 'HEAD');
    git('commit', '--allow-empty', '-m', 'newer-fold');
    const sha = git('rev-parse', 'HEAD');
    const onto = git('rev-parse', 'HEAD~3');
    await vscode.commands.executeCommand(
      'gitCheckout.sidebar.revealInGraph', await readyRef(ctx.api, 'main'),
    );
    await waitForGitCheckoutPanel();
    await vscode.commands.executeCommand(
      'gitCheckout.graph.interactiveRebase', graphCommitContext(onto, 'init'),
    );
    await ctx.api.sendPanelMessage({ type: 'rebaseSetCommand', hash: middle, command: 'fixup' });
    await ctx.api.sendPanelMessage({ type: 'rebaseSetCommand', hash: sha, command: 'fixup' });
    await ctx.api.sendPanelMessage({ type: 'rebaseStart' });
    await waitFor('newest commit folded into older target', async () =>
      git('rev-list', '--count', `${onto}..HEAD`) === '1'
        && git('log', '-1', '--format=%B') === 'older-target\n\nRetained target body' ? true : undefined);
  });

  it('leaves a rebase that stopped on a conflict to the banner above the graph', async () => {
    const write = (text: string, message: string): string => {
      writeFileSync(join(repoRoot(), 'f.txt'), text);
      git('add', 'f.txt');
      git('commit', '-m', message);
      return git('rev-parse', 'HEAD');
    };
    const onto = write('base\n', 'base');
    const first = write('first\n', 'first');
    write('first and second\n', 'second');
    await vscode.commands.executeCommand('gitCheckout.graph.interactiveRebase', graphCommitContext(onto, 'base'));
    // Without the first commit the second no longer applies.
    await ctx.api.sendPanelMessage({ type: 'rebaseSetCommand', hash: first, command: 'drop' });
    await ctx.api.sendPanelMessage({ type: 'rebaseStart' });

    const banner = await waitFor('the banner for the stopped rebase', async () => {
      const model = await ctx.api.operationBanner();
      return model && /^Rebasing/.test(model.title) ? model : undefined;
    });
    assert.equal(banner.primary, 'resolve');
    assert.match(git('status', '--porcelain'), /^UU f\.txt$/m);
    git('rebase', '--abort');
  });
});
