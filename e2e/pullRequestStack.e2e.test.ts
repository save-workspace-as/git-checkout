import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';

import { answer, branchContext, cancelForm, commitFile, gitIn, submitForm } from './graphMenu';
import { bindExtension, git, readyTree, repoRoot, resetToRepository, waitFor } from './harness';

describe('Create Pull Request Stack', () => {
  const ctx = bindExtension();
  const requests: { method: string; url: string; body: unknown }[] = [];
  const messages: string[] = [];
  let undo: (() => void)[] = [];
  let remote = '';
  let first = '';

  beforeEach(async () => {
    await readyTree(ctx.api);
    await resetToRepository(ctx.api, repoRoot());
    requests.length = 0;
    messages.length = 0;
    remote = mkdtempSync(join(tmpdir(), 'git-checkout-stack-remote-'));
    gitIn(remote, 'init', '--bare', '--initial-branch=main');
    commitFile('base.txt', 'base\n', 'base');
    git('checkout', '-q', '-b', 'feat/x');
    first = commitFile('schema.txt', 'schema\n', 'Add schema');
    commitFile('api.txt', 'api\n', 'Add api');
    commitFile('page.txt', 'page\n', 'Add page');
    git('checkout', '-q', 'main');
    // GitHub's address names the repository; the pushes go to a folder instead.
    git('remote', 'add', 'origin', 'https://github.com/octo/app.git');
    git('config', 'remote.origin.pushurl', remote);
    let number = 20;
    ctx.api.seedGitHub({
      token: 'test-token',
      transport: {
        async request(method, url, _token, body) {
          requests.push({ method, url, body });
          if (method === 'GET') { return { status: 200, json: [] }; }
          if (url.endsWith('/stacks')) { return { status: 201, json: { number: 4, pull_requests: (body as { pull_requests: number[] }).pull_requests.map((n) => ({ number: n })) } }; }
          const input = body as { base: string };
          number++;
          return { status: 201, json: { number, html_url: `https://github.com/octo/app/pull/${number}`, base: { ref: input.base }, draft: true } };
        },
      },
    });
    undo = [answer('showInformationMessage', async (message: unknown) => { messages.push(String(message)); return undefined; })];
  });

  afterEach(() => {
    ctx.api.seedGitHub(undefined);
    for (const restore of undo.reverse()) { restore(); }
    git('config', '--unset', 'remote.origin.pushurl');
    git('remote', 'remove', 'origin');
    rmSync(remote, { recursive: true, force: true });
  });

  const created = () => requests.filter((r) => r.method === 'POST' && r.url.endsWith('/pulls')).map((r) => r.body);

  it('lists the commits newest first in a modal, and makes nothing when it is canceled', async () => {
    const values = await cancelForm(ctx.api, vscode.commands.executeCommand('gitCheckout.pullRequests.createStack', { ref: 'feat/x' }), 'Create Pull Request Stack');
    assert.equal(values['branch-2'], 'feat/x');
    assert.equal(values['title-2'], 'Add page');
    assert.equal(values['end-1'], false);
    assert.equal(values['title-0'], 'Add schema');
    assert.deepEqual(requests, []);
    assert.equal(git('branch', '--list', 'feat/x-*'), '');
  });

  it('cuts the branch where the commits are chosen: makes their branches, pushes them and opens a pull request for each', async () => {
    const command = vscode.commands.executeCommand('gitCheckout.pullRequests.createStack', { ref: 'feat/x' });
    await submitForm(ctx.api, command, 'Create Pull Request Stack', { 'end-0': true, 'branch-0': 'feat/x-schema', 'title-0': 'Add the schema' });

    assert.equal(git('rev-parse', 'feat/x-schema'), first);
    assert.deepEqual(gitIn(remote, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n').sort(), ['feat/x', 'feat/x-schema']);
    assert.deepEqual(created(), [
      { title: 'Add the schema', head: 'feat/x-schema', base: 'main', body: '', draft: true },
      { title: 'Add page', head: 'feat/x', base: 'feat/x-schema', body: '- Add api\n- Add page', draft: true },
    ]);
    assert.deepEqual(requests.at(-1)?.body, { pull_requests: [21, 22] });
    await waitFor('the result message', async () => (messages.length > 0 ? true : undefined));
    assert.equal(messages[0], 'Opened 2 pull requests as a stack.');
  });

  it('is one pull request from the branch when no other commit is chosen, and is not a stack', async () => {
    const command = vscode.commands.executeCommand('gitCheckout.pullRequests.createStack', { ref: 'feat/x' });
    await submitForm(ctx.api, command, 'Create Pull Request Stack', { draft: 'ready' });
    assert.deepEqual(created().map((body) => (body as { base: string; head: string }).head), ['feat/x']);
    assert.ok(!requests.some((r) => r.url.endsWith('/stacks')));
    assert.equal(git('branch', '--list', 'feat/x-*'), '');
    await waitFor('the result message', async () => (messages.length > 0 ? true : undefined));
    assert.equal(messages[0], 'Opened pull request #21.');
  });

  it('is in the graph\'s branch menu', async () => {
    const values = await cancelForm(ctx.api, vscode.commands.executeCommand('gitCheckout.graph.branch.pullRequestStack', branchContext('feat/x')), 'Create Pull Request Stack');
    assert.equal(values['branch-2'], 'feat/x');
  });
});
