import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';

import { answer } from './graphMenu';
import { bindExtension, changeGroupRows, git, readyTree, repoRoot, resetToRepository, waitFor, type ChangeRow } from './harness';

describe('Review Staged Changes with AI', () => {
  const ctx = bindExtension();
  const prompts: string[] = [];
  const messages: string[] = [];
  let undo: (() => void)[] = [];
  let reply = '';

  beforeEach(async () => {
    await readyTree(ctx.api);
    await resetToRepository(ctx.api, repoRoot());
    prompts.length = 0;
    messages.length = 0;
    reply = '- `review.txt`: the password is written in clear text.';
    undo = [
      answer('showInformationMessage', async (message: unknown) => { messages.push(String(message)); return undefined; }),
      answer('showWarningMessage', async (message: unknown) => { messages.push(String(message)); return undefined; }),
      answer('showErrorMessage', async (message: unknown) => { messages.push(String(message)); return undefined; }),
    ];
    ctx.api.seedLanguageModel(async (prompt) => { prompts.push(prompt); return reply; });
  });

  afterEach(async () => {
    ctx.api.seedLanguageModel(undefined);
    for (const restore of undo.reverse()) { restore(); }
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  const stage = (): void => {
    writeFileSync(join(repoRoot(), 'review.txt'), 'password = hunter2\n');
    git('add', 'review.txt');
  };

  it('opens the model\'s findings for the staged changes, and sends it only what is staged', async () => {
    stage();
    writeFileSync(join(repoRoot(), 'unstaged.txt'), 'not staged\n');
    await ctx.api.sendPanelMessage({ type: 'changesReviewStaged' });
    const document = await waitFor('the review', async () =>
      vscode.workspace.textDocuments.find((candidate) => candidate.languageId === 'markdown' && candidate.getText().includes('password is written in clear text')),
    );
    assert.ok(document.getText().startsWith('# Review of the staged changes\n\n- `review.txt`'));
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /\+password = hunter2/);
    assert.doesNotMatch(prompts[0], /unstaged\.txt/);
  });

  it('runs from the menu of the Staged group, too', async () => {
    stage();
    // The lists follow the built-in Git extension's state, which follows files on disk with a delay of its own.
    await waitFor('the staged group', async () => {
      await vscode.commands.executeCommand('git.refresh');
      await ctx.api.sendPanelMessage({ type: 'changesReady' });
      return (await changeGroupRows(ctx.api, 'staged')).length > 0 ? true : undefined;
    }, 30_000);
    const group = ((await ctx.api.changesList.getChildren()) as ChangeRow[]).find((row) => row.group && row.side === 'staged')!;
    assert.equal((await ctx.api.changesList.getTreeItem(group)).contextValue, 'change.group.staged');
    await vscode.commands.executeCommand('gitCheckout.changes.review', group);
    await waitFor('the model to be asked', async () => (prompts.length === 1 ? true : undefined));
  });

  it('says so, and asks nothing, when nothing is staged', async () => {
    await ctx.api.sendPanelMessage({ type: 'changesReviewStaged' });
    await waitFor('the message', async () => (messages.some((message) => /Stage changes first, then review them/.test(message)) ? true : undefined));
    assert.equal(prompts.length, 0);
  });

  it('says so when the model fails, and opens nothing', async () => {
    stage();
    ctx.api.seedLanguageModel(async () => { throw new Error('quota used up'); });
    await ctx.api.sendPanelMessage({ type: 'changesReviewStaged' });
    await waitFor('the message', async () => (messages.some((message) => /Could not review the changes: quota used up/.test(message)) ? true : undefined));
    assert.equal(vscode.workspace.textDocuments.some((candidate) => candidate.getText().includes('Review of the staged changes')), false);
  });

  it('does not ask the model, and says the setting is off, when the AI features are turned off', async () => {
    stage();
    const config = vscode.workspace.getConfiguration('gitCheckout');
    await config.update('ai.enabled', false, vscode.ConfigurationTarget.Global);
    try {
      await ctx.api.sendPanelMessage({ type: 'changesReviewStaged' });
      await waitFor('the message', async () => (messages.some((message) => /AI features are turned off/.test(message)) ? true : undefined));
      assert.equal(prompts.length, 0);
    } finally {
      await config.update('ai.enabled', undefined, vscode.ConfigurationTarget.Global);
    }
  });
});
