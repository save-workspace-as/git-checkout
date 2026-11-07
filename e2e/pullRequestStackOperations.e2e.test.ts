import { strict as assert } from 'node:assert';
import * as vscode from 'vscode';

import { answer, commitFile, gitIn, submitForm } from './graphMenu';
import { bindExtension, git, loadTree, readyTree, waitFor, type SidebarNode } from './harness';
import { makeStack } from './stackFixture';

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
});
