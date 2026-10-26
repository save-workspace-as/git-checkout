import { strict as assert } from 'node:assert';
import * as vscode from 'vscode';

import { bindExtension, git, readyTree, waitFor } from './harness';

describe('Repository Settings', () => {
  const ctx = bindExtension();

  const localValue = (key: string): string => {
    try {
      return git('config', '--local', '--get', key);
    } catch {
      return '';
    }
  };

  it('shows Git settings of the repository and saves only what changed, with git config --local', async () => {
    await readyTree(ctx.api);
    git('config', '--local', 'user.email', 'fixture@example.com');
    const command = vscode.commands.executeCommand('gitCheckout.repoSettings');
    const state = await waitFor('settings form', async () => ctx.api.operationFormState());
    assert.equal(state.form.title, 'Repository Settings');
    assert.equal(state.form.values['user.email'], 'fixture@example.com');
    await ctx.api.sendPanelMessage({
      type: 'operationFormMessage', sessionId: state.sessionId,
      message: { type: 'formSubmit', values: { ...state.form.values, 'user.email': '', 'pull.rebase': 'true', 'fetch.prune': true } },
    });
    await command;
    await waitFor('settings saved', async () => (localValue('pull.rebase') === 'true' ? true : undefined));
    assert.equal(localValue('fetch.prune'), 'true');
    assert.equal(localValue('user.email'), '', 'cleared: the repository uses the global value again');
    assert.equal(localValue('merge.ff'), '', 'untouched settings get no repository value');
  });
});
