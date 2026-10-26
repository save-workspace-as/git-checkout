import { strict as assert } from 'node:assert';
import * as vscode from 'vscode';

import { bindExtension, readyTree, waitFor, waitForGitCheckoutPanel } from './harness';

const SETTING = 'graph.showReflog';

function showReflogSetting(): boolean | undefined {
  return vscode.workspace.getConfiguration('gitCheckout').get<boolean>(SETTING);
}

async function clearSetting(): Promise<void> {
  const config = vscode.workspace.getConfiguration('gitCheckout');
  await config.update(SETTING, undefined, vscode.ConfigurationTarget.Workspace);
}

describe('Reflog mode', () => {
  const ctx = bindExtension();

  afterEach(clearSetting);

  it('no longer contributes a Reflog view to the sidebar', async () => {
    const commands = await vscode.commands.getCommands(true);
    const leftovers = commands.filter(
      (command) => command.startsWith('gitCheckout.') && /reflog/i.test(command) && !command.includes('.graph.'),
    );
    assert.deepEqual(leftovers, []);
    assert.equal('reflog' in ctx.api, false);
  });

  it('defaults to off and follows the gitCheckout.graph.showReflog setting', async () => {
    await readyTree(ctx.api);
    assert.equal(showReflogSetting(), false);
    await vscode.workspace.getConfiguration('gitCheckout')
      .update(SETTING, true, vscode.ConfigurationTarget.Workspace);
    assert.equal(showReflogSetting(), true);
  });

  it('turns the setting off when the graph banner sends Exit', async () => {
    await readyTree(ctx.api);
    await vscode.commands.executeCommand('gitCheckout.open');
    await waitForGitCheckoutPanel();
    await vscode.workspace.getConfiguration('gitCheckout')
      .update(SETTING, true, vscode.ConfigurationTarget.Workspace);
    await waitFor('reflog setting enabled', async () => (showReflogSetting() ? true : undefined));

    await ctx.api.sendPanelMessage({ type: 'graphExitReflog' });
    await waitFor('reflog setting disabled', async () => (showReflogSetting() === false ? true : undefined));
  });

  it('shows and hides reflog commits from the graph title commands', async () => {
    await readyTree(ctx.api);
    await vscode.commands.executeCommand('gitCheckout.open');
    await waitForGitCheckoutPanel();

    await vscode.commands.executeCommand('gitCheckout.graph.showReflog');
    await waitFor('reflog setting enabled', async () => (showReflogSetting() ? true : undefined));
    await vscode.commands.executeCommand('gitCheckout.graph.hideReflog');
    await waitFor('reflog setting disabled', async () => (showReflogSetting() === false ? true : undefined));
  });
});
