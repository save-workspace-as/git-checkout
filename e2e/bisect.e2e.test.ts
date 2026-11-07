import { strict as assert } from 'node:assert';
import * as vscode from 'vscode';

import { cancelForm, commitFile, submitForm } from './graphMenu';
import { bindExtension, git, readyTree, waitFor } from './harness';

describe('Start Bisect', () => {
  const ctx = bindExtension();

  async function threeCommits(): Promise<string> {
    const first = commitFile('a.txt', 'a\n', 'first');
    commitFile('b.txt', 'b\n', 'second');
    commitFile('c.txt', 'c\n', 'third');
    return first;
  }

  it('starts a bisect from the bad and good revisions entered in one form', async () => {
    await readyTree(ctx.api);
    const first = await threeCommits();

    await submitForm(ctx.api, vscode.commands.executeCommand('gitCheckout.bisect.start'), 'Start Bisect', { bad: 'HEAD', good: first });

    await waitFor('the bisect to start', async () => (git('bisect', 'log').includes('git bisect start') ? true : undefined));
    assert.match(git('bisect', 'log'), new RegExp(`# good: \\[${first}\\]`));
  });

  it('keeps the form open and starts nothing when a revision is not a commit', async () => {
    await readyTree(ctx.api);
    await threeCommits();

    const command = vscode.commands.executeCommand('gitCheckout.bisect.start');
    const state = await waitFor('Start Bisect modal', async () => ctx.api.operationFormState());
    await ctx.api.sendPanelMessage({
      type: 'operationFormMessage', sessionId: state.sessionId,
      message: { type: 'formSubmit', values: { bad: 'HEAD', good: 'no-such-revision' } },
    });
    await waitFor('the error to leave the form open', async () => (ctx.api.operationFormState() ? true : undefined));
    assert.throws(() => git('bisect', 'log'));
    await cancelForm(ctx.api, command, 'Start Bisect');
  });

  it('starts nothing when the form is canceled', async () => {
    await readyTree(ctx.api);
    await threeCommits();
    const values = await cancelForm(ctx.api, vscode.commands.executeCommand('gitCheckout.bisect.start'), 'Start Bisect');
    assert.equal(values.bad, 'HEAD');
    assert.throws(() => git('bisect', 'log'));
  });
});
