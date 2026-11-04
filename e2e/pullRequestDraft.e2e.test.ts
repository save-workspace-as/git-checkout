import { strict as assert } from 'node:assert';
import * as vscode from 'vscode';

import { answer, commitFile } from './graphMenu';
import { bindExtension, git, readyTree, repoRoot, resetToRepository, waitFor } from './harness';

describe('Open Pull Request with AI Description', () => {
  const ctx = bindExtension();
  const opened: vscode.Uri[] = [];
  const prompts: string[] = [];
  const messages: string[] = [];
  let undo: (() => void)[] = [];
  let reply = '';

  beforeEach(async () => {
    await readyTree(ctx.api);
    await resetToRepository(ctx.api, repoRoot());
    opened.length = 0;
    prompts.length = 0;
    messages.length = 0;
    reply = 'Speed up blame\n\nBlame now reads the file once.\n\n- one pass\n- cached';
    commitFile('base.txt', 'base\n', 'base');
    git('checkout', '-q', '-b', 'speed');
    commitFile('speed.txt', 'fast\n', 'perf: read the file once');
    git('checkout', '-q', 'main');
    git('remote', 'add', 'origin', 'https://github.com/octo/app.git');
    const env = vscode.env as unknown as { openExternal: (uri: vscode.Uri) => Thenable<boolean> };
    const original = env.openExternal;
    env.openExternal = async (uri) => { opened.push(uri); return true; };
    undo = [
      () => { env.openExternal = original; },
      answer('showInformationMessage', async (message: unknown) => { messages.push(String(message)); return undefined; }),
      answer('showErrorMessage', async (message: unknown) => { messages.push(String(message)); return undefined; }),
    ];
    ctx.api.seedLanguageModel(async (prompt) => { prompts.push(prompt); return reply; });
  });

  afterEach(() => {
    ctx.api.seedLanguageModel(undefined);
    // The stubs go back in the reverse of the order they were put in.
    for (const restore of undo.reverse()) { restore(); }
    git('remote', 'remove', 'origin');
  });

  const run = (): Thenable<unknown> => vscode.commands.executeCommand('gitCheckout.sidebar.openPullRequestWithAi', { ref: 'speed' });

  it('opens the pull request page with the title and description the model wrote from the commits and changes', async () => {
    await run();
    await waitFor('the page to open', async () => (opened.length > 0 ? true : undefined));
    assert.equal(`${opened[0].authority}${opened[0].path}`, 'github.com/octo/app/pull/new/speed');
    const query = new URLSearchParams(opened[0].query);
    assert.equal(query.get('title'), 'Speed up blame');
    assert.equal(query.get('body'), 'Blame now reads the file once.\n\n- one pass\n- cached');
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /branch "speed", to merge into "main"/);
    assert.match(prompts[0], /- perf: read the file once/);
    assert.match(prompts[0], /\+\+\+ b\/speed\.txt/);
  });

  it('opens the plain page, and says why, when the model fails', async () => {
    ctx.api.seedLanguageModel(async () => { throw new Error('quota used up'); });
    await run();
    await waitFor('the page to open', async () => (opened.length > 0 ? true : undefined));
    assert.equal(opened[0].toString(), 'https://github.com/octo/app/pull/new/speed');
    assert.ok(messages.some((message) => /Could not write a pull request description: quota used up/.test(message)));
  });

  it('opens the plain page when the model has no title to give', async () => {
    reply = '   ';
    await run();
    await waitFor('the page to open', async () => (opened.length > 0 ? true : undefined));
    assert.equal(opened[0].toString(), 'https://github.com/octo/app/pull/new/speed');
  });

  it('puts a description a link cannot carry on the clipboard, and keeps a safe title in the link', async () => {
    reply = 'Fix A & B\n\nCloses #12 and adds C++ support.';
    await run();
    await waitFor('the page to open', async () => (opened.length > 0 ? true : undefined));
    const query = new URLSearchParams(opened[0].query);
    assert.equal(query.get('title'), 'Fix A and B');
    assert.equal(query.get('body') ?? '', '');
    assert.equal(await vscode.env.clipboard.readText(), 'Closes #12 and adds C++ support.');
    assert.ok(messages.some((message) => /description is on your clipboard/.test(message)));
  });

  it('opens nothing, and says so, for a branch with no commits of its own', async () => {
    git('branch', 'level');
    await vscode.commands.executeCommand('gitCheckout.sidebar.openPullRequestWithAi', { ref: 'level' });
    await waitFor('the message', async () => (messages.some((message) => /no commits that 'main' does not have/.test(message)) ? true : undefined));
    assert.deepEqual(opened, []);
    assert.equal(prompts.length, 0);
  });

  it('opens the plain page, and says the setting is off, when the AI features are turned off', async () => {
    const config = vscode.workspace.getConfiguration('gitCheckout');
    await config.update('ai.enabled', false, vscode.ConfigurationTarget.Global);
    try {
      await run();
      await waitFor('the page to open', async () => (opened.length > 0 ? true : undefined));
      assert.equal(opened[0].toString(), 'https://github.com/octo/app/pull/new/speed');
      assert.ok(messages.some((message) => /AI features are turned off/.test(message)));
      assert.equal(prompts.length, 0);
    } finally {
      await config.update('ai.enabled', undefined, vscode.ConfigurationTarget.Global);
    }
  });
});
