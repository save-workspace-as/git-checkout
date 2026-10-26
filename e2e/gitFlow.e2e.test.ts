import { strict as assert } from 'node:assert';
import * as vscode from 'vscode';

import { bindExtension, git, waitFor } from './harness';

interface GitFlowOutcome {
  available: boolean;
  ran: boolean;
  commands: string[];
  message: string;
}

describe('Git-flow and signing', () => {
  const ctx = bindExtension();

  /** vscode.git briefly holds index.lock while it indexes a fresh fixture, which fails the checkout. */
  async function submitUntilClosed(sessionId: number, values: Record<string, string | boolean>): Promise<void> {
    await waitFor('init form to close', async () => {
      await ctx.api.sendPanelMessage({
        type: 'operationFormMessage', sessionId, message: { type: 'formSubmit', values },
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      return ctx.api.operationFormState() ? undefined : true;
    });
  }

  async function closeForm(): Promise<void> {
    const active = ctx.api.operationFormState();
    if (active) {
      await ctx.api.sendPanelMessage({
        type: 'operationFormMessage', sessionId: active.sessionId, message: { type: 'formCancel' },
      });
    }
  }

  it('opens the Gitflow Init form and initializes the repository on submit', async () => {
    const pending = vscode.commands.executeCommand('gitCheckout.gitFlow') as Promise<GitFlowOutcome | undefined>;
    try {
      const state = await waitFor('Gitflow Init form', async () => ctx.api.operationFormState());
      assert.equal(state.form.title, 'Initialize Git Flow');
      assert.deepEqual(state.form.fields.map((field) => field.id), [
        'production', 'develop', 'featurePrefix', 'releasePrefix', 'hotfixPrefix', 'versionTagPrefix',
      ]);
      assert.deepEqual(state.form.values, {
        production: 'main', develop: 'develop', featurePrefix: 'feature/', releasePrefix: 'release/',
        hotfixPrefix: 'hotfix/', versionTagPrefix: '',
      });
      await submitUntilClosed(state.sessionId, { ...state.form.values, develop: 'dev', versionTagPrefix: 'v' });
      const result = await pending;
      assert.equal(result?.ran, true);
      assert.equal(git('branch', '--show-current'), 'dev');
      assert.equal(git('config', '--get', 'gitflow.branch.master'), 'main');
      assert.equal(git('config', '--get', 'gitflow.branch.develop'), 'dev');
      assert.equal(git('config', '--get', 'gitflow.prefix.feature'), 'feature/');
      assert.equal(git('config', '--get', 'gitflow.prefix.versiontag'), 'v');
    } finally {
      await closeForm();
      await pending;
    }
  });

  it('keeps the form open and changes nothing for an invalid layout', async () => {
    const pending = vscode.commands.executeCommand('gitCheckout.gitFlow') as Promise<GitFlowOutcome | undefined>;
    try {
      const state = await waitFor('Gitflow Init form', async () => ctx.api.operationFormState());
      await ctx.api.sendPanelMessage({
        type: 'operationFormMessage', sessionId: state.sessionId,
        message: { type: 'formSubmit', values: { ...state.form.values, develop: 'main', featurePrefix: '' } },
      });
      assert.ok(ctx.api.operationFormState(), 'form stays open');
      assert.equal(git('branch', '--list', 'develop'), '');
      assert.equal(git('branch', '--show-current'), 'main');
    } finally {
      await closeForm();
      assert.equal(await pending, undefined);
    }
  });

  it('opens the same form from the repository dropdown', async () => {
    const pending = vscode.commands.executeCommand('gitCheckout.repo.0.gitFlow');
    try {
      const state = await waitFor('Gitflow Init form', async () => ctx.api.operationFormState());
      assert.equal(state.form.title, 'Initialize Git Flow');
    } finally {
      await closeForm();
      await pending;
    }
  });

  it('initializes from a command argument and reuses an existing development branch', async () => {
    git('branch', 'develop');
    await waitFor('git-flow initialized', async () => {
      const result = (await vscode.commands.executeCommand('gitCheckout.gitFlow', { action: 'init' })) as
        GitFlowOutcome | undefined;
      return result?.ran ? true : undefined;
    });
    assert.equal(git('branch', '--show-current'), 'develop');
  });

  it('shows documented commands when git-flow is missing', async () => {
    const result = (await vscode.commands.executeCommand('gitCheckout.gitFlow', {
      action: 'start',
      kind: 'feature',
      name: 'widget',
    })) as GitFlowOutcome | undefined;

    assert.ok(result, 'git flow command returned no result');
    if (!result.available) {
      assert.equal(result.ran, false);
      assert.match(result.message, /not installed/);
      assert.ok(result.commands.some((line) => line.includes('feature/widget')));
      assert.equal(git('branch', '--list', 'feature/widget'), '');
      return;
    }
    if (result.ran) {
      assert.match(git('branch', '--list', 'feature/widget'), /feature\/widget/);
      git('checkout', 'main');
      git('branch', '-D', 'feature/widget');
    }
  });

  it('toggles commit and tag signing in the repository config', async () => {
    assert.equal(
      await vscode.commands.executeCommand('gitCheckout.toggleSigning', {
        target: 'commit',
        enabled: true,
      }),
      true,
    );
    assert.equal(git('config', '--get', 'commit.gpgsign'), 'true');

    assert.equal(
      await vscode.commands.executeCommand('gitCheckout.toggleSigning', {
        target: 'tag',
        enabled: false,
      }),
      false,
    );
    assert.equal(git('config', '--get', 'tag.gpgSign'), 'false');
  });
});