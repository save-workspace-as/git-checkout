import { strict as assert } from 'node:assert';
import * as vscode from 'vscode';

import { bindExtension, readyTree } from './harness';

describe('Autolinks', () => {
  const ctx = bindExtension();
  const opened: string[] = [];
  let restore: () => void;

  beforeEach(async () => {
    await readyTree(ctx.api);
    opened.length = 0;
    const env = vscode.env as unknown as { openExternal: (uri: vscode.Uri) => Thenable<boolean> };
    const original = env.openExternal;
    env.openExternal = async (uri) => { opened.push(uri.toString()); return true; };
    restore = () => { env.openExternal = original; };
    await vscode.workspace.getConfiguration('gitCheckout').update(
      'autolinks',
      [{ prefix: 'JIRA-', url: 'https://jira.example.com/browse/JIRA-<num>' }],
      vscode.ConfigurationTarget.Global,
    );
  });

  afterEach(async () => {
    restore();
    await vscode.workspace.getConfiguration('gitCheckout').update('autolinks', undefined, vscode.ConfigurationTarget.Global);
  });

  it('opens a link on a site the setting names, and refuses any other address', async () => {
    await ctx.api.sendPanelMessage({ type: 'openGitHubLink', url: 'https://jira.example.com/browse/JIRA-7' });
    assert.deepEqual(opened, ['https://jira.example.com/browse/JIRA-7']);
    await ctx.api.sendPanelMessage({ type: 'openGitHubLink', url: 'https://evil.example.com/browse/JIRA-7' });
    await ctx.api.sendPanelMessage({ type: 'openGitHubLink', url: 'javascript:alert(1)' });
    assert.equal(opened.length, 1, 'only the first was opened');
  });
});
