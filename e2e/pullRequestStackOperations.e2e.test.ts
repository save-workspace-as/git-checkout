import { strict as assert } from 'node:assert';
import * as vscode from 'vscode';

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { answer, commitFile, gitIn, submitForm } from './graphMenu';
import { bindExtension, git, loadTree, readyTree, repoRoot, waitFor, type SidebarNode } from './harness';
import { makeStack, seedStack, stackPull } from './stackFixture';

const walk = (node: SidebarNode): SidebarNode[] => [node, ...(node.children ?? []).flatMap(walk)];

describe('Operations on a stack of pull requests', () => {
  const ctx = bindExtension();
  const messages: string[] = [];
  let stack: Awaited<ReturnType<typeof makeStack>>;
  let undo: (() => void)[] = [];

  const stackNode = () => waitFor('the stack', async () =>
    (await loadTree(ctx.api)).flatMap(walk).find((node) => node.kind === 'folder' && node.label === 'stack-c'));
  const remoteBranches = () => gitIn(stack.remote, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n').filter(Boolean).sort();

  beforeEach(async () => {
    await readyTree(ctx.api);
    messages.length = 0;
    stack = await makeStack(ctx.api);
    undo = [answer('showInformationMessage', async (message: unknown) => { messages.push(String(message)); return undefined; })];
  });

  afterEach(() => {
    for (const restore of undo.reverse()) { restore(); }
    stack.cleanup();
  });

  describe('Push Stack', () => {
    it('pushes every branch of the stack in one push, and again after the branches were rewritten', async () => {
      await submitForm(ctx.api, vscode.commands.executeCommand('gitCheckout.pullRequests.pushStack', await stackNode()), 'Push Stack');
      assert.deepEqual(remoteBranches(), ['stack-a', 'stack-b', 'stack-c']);
      assert.equal(gitIn(stack.remote, 'rev-parse', 'stack-c'), stack.shas[2]);
      assert.deepEqual(messages, ['Pushed 3 branches.']);

      git('checkout', '-q', 'stack-a');
      git('commit', '--amend', '-q', '-m', 'reworded');
      await submitForm(ctx.api, vscode.commands.executeCommand('gitCheckout.pullRequests.pushStack', await stackNode()), 'Push Stack');
      assert.equal(gitIn(stack.remote, 'rev-parse', 'stack-a'), git('rev-parse', 'stack-a'));
    });

    it('is for the stack of the checked-out branch when none was right-clicked', async () => {
      await submitForm(ctx.api, vscode.commands.executeCommand('gitCheckout.pullRequests.pushStack'), 'Push Stack');
      assert.deepEqual(remoteBranches(), ['stack-a', 'stack-b', 'stack-c']);
    });

    it('leaves out a layer that has no branch here, and says so when none has', async () => {
      git('branch', '-D', 'stack-c');
      await submitForm(ctx.api, vscode.commands.executeCommand('gitCheckout.pullRequests.pushStack', await stackNode()), 'Push Stack');
      assert.deepEqual(remoteBranches(), ['stack-a', 'stack-b']);
      git('checkout', '-q', 'main');
      commitFile('x.txt', 'x\n', 'x');
      git('branch', '-D', 'stack-a', 'stack-b');
      await vscode.commands.executeCommand('gitCheckout.pullRequests.pushStack', await stackNode());
      assert.equal(messages.at(-1), 'None of the branches of this stack is checked out here.');
    });
  });

  describe('Rebase Stack', () => {
    const subjects = (range: string) => git('log', '--format=%s', '--reverse', range).split('\n').filter(Boolean);

    it('moves every layer onto a base branch that moved on, and puts the person back on their branch', async () => {
      git('checkout', '-q', 'main');
      commitFile('main.txt', 'main\n', 'main moves');
      git('checkout', '-q', 'stack-b');
      await submitForm(ctx.api, vscode.commands.executeCommand('gitCheckout.pullRequests.rebaseStack', await stackNode()), 'Rebase Stack');
      assert.deepEqual(subjects('main..stack-c'), ['Layer 1', 'Layer 2', 'Layer 3']);
      assert.deepEqual(subjects('stack-a..stack-b'), ['Layer 2']);
      assert.equal(git('branch', '--show-current'), 'stack-b');
      await waitFor('the result message', async () => (messages.length > 0 ? true : undefined));
      assert.equal(messages[0], 'Rebased 3 branches.');
    });

    it('says the stack is up to date when nothing needs to move', async () => {
      await submitForm(ctx.api, vscode.commands.executeCommand('gitCheckout.pullRequests.rebaseStack'), 'Rebase Stack');
      await waitFor('the result message', async () => (messages.length > 0 ? true : undefined));
      assert.equal(messages[0], 'The stack is up to date.');
    });

    it('stops at a conflict, and finishes the layers above when it is run again after the conflict was resolved', async () => {
      git('checkout', '-q', 'main');
      commitFile('stack-b.txt', 'main wrote it\n', 'main writes b');
      git('checkout', '-q', 'stack-c');
      await submitForm(ctx.api, vscode.commands.executeCommand('gitCheckout.pullRequests.rebaseStack'), 'Rebase Stack');
      await waitFor('the conflict message', async () => messages.find((message) => message.includes('stopped for conflicts')));
      assert.ok(git('status', '--porcelain').includes('stack-b.txt'), 'the rebase is waiting on layer 2');

      writeFileSync(join(repoRoot(), 'stack-b.txt'), 'stack-b\n');
      git('add', 'stack-b.txt');
      git('-c', 'core.editor=true', 'rebase', '--continue');
      messages.length = 0;
      await submitForm(ctx.api, vscode.commands.executeCommand('gitCheckout.pullRequests.rebaseStack'), 'Rebase Stack');
      await waitFor('the result message', async () => (messages.length > 0 ? true : undefined));
      assert.equal(messages[0], 'Rebased 1 branch.');
      assert.deepEqual(subjects('main..stack-c'), ['Layer 1', 'Layer 2', 'Layer 3']);
    });
  });

  describe('Sync Stack', () => {
    const requests: { method: string; url: string; body: unknown }[] = [];
    /** A GitHub whose stacks are `existing`, or that refuses them with `refuse`. */
    const github = (existing: unknown[] = [], refuse?: number) => ctx.api.seedGitHub({
      token: 'test-token',
      transport: {
        async request(method, url, _token, body) {
          requests.push({ method, url, body });
          if (refuse) { return { status: refuse, json: { message: 'Resource not accessible by integration' } }; }
          return method === 'GET' ? { status: 200, json: existing } : { status: 201, json: { number: 5, open: true, pull_requests: [] } };
        },
      },
    });

    beforeEach(() => {
      requests.length = 0;
      git('checkout', '-q', 'main');
      commitFile('main.txt', 'main\n', 'main moves');
      git('checkout', '-q', 'stack-b');
    });

    afterEach(() => ctx.api.seedGitHub(undefined));

    it('rebases the stack onto its base, pushes the branches and groups the pull requests as a stack', async () => {
      github();
      await submitForm(ctx.api, vscode.commands.executeCommand('gitCheckout.pullRequests.syncStack', await stackNode()), 'Sync Stack');
      assert.deepEqual(git('log', '--format=%s', '--reverse', 'main..stack-c').split('\n'), ['Layer 1', 'Layer 2', 'Layer 3']);
      assert.deepEqual(remoteBranches(), ['stack-a', 'stack-b', 'stack-c']);
      assert.equal(gitIn(stack.remote, 'rev-parse', 'stack-c'), git('rev-parse', 'stack-c'));
      assert.equal(git('branch', '--show-current'), 'stack-b');
      assert.deepEqual(requests.map((r) => [r.method, r.url.replace('https://api.github.com/repos/octo/app', '')]), [['GET', '/stacks?per_page=100'], ['POST', '/stacks']]);
      assert.deepEqual(requests[1].body, { pull_requests: [1, 2, 3] });
      await waitFor('the result message', async () => (messages.length > 0 ? true : undefined));
      assert.equal(messages[0], 'Rebased 3 branches. Pushed 3 branches. Grouped the pull requests as a stack on GitHub.');
    });

    it('leaves a stack on GitHub that is the same already, and adds what is missing to one that has the first pull requests', async () => {
      github([{ number: 5, open: true, pull_requests: [{ number: 1 }, { number: 2 }, { number: 3 }] }]);
      await submitForm(ctx.api, vscode.commands.executeCommand('gitCheckout.pullRequests.syncStack'), 'Sync Stack');
      await waitFor('the result message', async () => (messages.length > 0 ? true : undefined));
      assert.match(messages[0], /The pull requests are one stack on GitHub\.$/);
      assert.deepEqual(requests.map((r) => r.method), ['GET']);

      requests.length = 0;
      messages.length = 0;
      // The first sync read the pull requests again, which the test answers from nowhere.
      seedStack(ctx.api, [stackPull(1, 'stack-a', 'main'), stackPull(2, 'stack-b', 'stack-a'), stackPull(3, 'stack-c', 'stack-b')]);
      github([{ number: 5, open: true, pull_requests: [{ number: 1 }, { number: 2 }] }]);
      await submitForm(ctx.api, vscode.commands.executeCommand('gitCheckout.pullRequests.syncStack'), 'Sync Stack');
      await waitFor('the result message', async () => (messages.length > 0 ? true : undefined));
      assert.match(messages[0], /Added 1 pull requests to the stack on GitHub\.$/);
      assert.deepEqual([requests[1].url.replace('https://api.github.com/repos/octo/app', ''), requests[1].body], ['/stacks/5/add', { pull_requests: [3] }]);
    });

    it('still rebases and pushes when GitHub does not take the stack, and says why', async () => {
      github([], 403);
      await submitForm(ctx.api, vscode.commands.executeCommand('gitCheckout.pullRequests.syncStack'), 'Sync Stack');
      await waitFor('the result message', async () => (messages.length > 0 ? true : undefined));
      assert.equal(messages[0], 'Rebased 3 branches. Pushed 3 branches. Not grouped as a stack: Resource not accessible by integration');
      assert.deepEqual(remoteBranches(), ['stack-a', 'stack-b', 'stack-c']);
    });

    it('only rebases when push and the stack are turned off', async () => {
      github();
      await submitForm(ctx.api, vscode.commands.executeCommand('gitCheckout.pullRequests.syncStack'), 'Sync Stack', { push: false, link: false });
      await waitFor('the result message', async () => (messages.length > 0 ? true : undefined));
      assert.equal(messages[0], 'Rebased 3 branches.');
      assert.deepEqual(remoteBranches(), []);
      assert.deepEqual(requests, []);
    });
  });
});
