import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';

import { answer, commitFile } from './graphMenu';
import { bindExtension, git, loadTree, readyTree, repoRoot, resetToRepository, waitFor, type SidebarNode } from './harness';

const walk = (node: SidebarNode): SidebarNode[] => [node, ...(node.children ?? []).flatMap(walk)];

describe('Moving through a stack of pull requests', () => {
  const ctx = bindExtension();
  const messages: string[] = [];
  let remote = '';
  let undo: (() => void)[] = [];

  const pull = (number: number, headRef: string, baseRef: string) => ({
    number, title: `Layer ${number}`, author: 'ada', isDraft: false, headRef, headRepository: 'octo/app', baseRef,
    reviewDecision: null, checks: null, mergeable: 'mergeable', updatedAt: '2026-10-30T10:00:00Z', url: `https://github.com/octo/app/pull/${number}`,
  });
  const seed = () => {
    const pulls = [pull(1, 'stack-a', 'main'), pull(2, 'stack-b', 'stack-a'), pull(3, 'stack-c', 'stack-b')];
    ctx.api.seedPullRequests(repoRoot(), { kind: 'ready', remote: 'origin', repo: { host: 'github.com', owner: 'octo', repo: 'app' }, lists: { createdByMe: pulls, reviewRequested: [], allOpen: pulls } });
  };
  const here = () => git('branch', '--show-current');
  const go = (name: string) => vscode.commands.executeCommand(`gitCheckout.pullRequests.${name}`);

  beforeEach(async () => {
    await readyTree(ctx.api);
    await resetToRepository(ctx.api, repoRoot());
    messages.length = 0;
    commitFile('base.txt', 'base\n', 'base');
    remote = mkdtempSync(join(tmpdir(), 'git-checkout-e2e-stack-'));
    git('init', '--bare', '-q', remote);
    git('remote', 'add', 'origin', remote);
    for (const [name, number] of [['stack-a', 1], ['stack-b', 2], ['stack-c', 3]] as const) {
      git('checkout', '-q', '-b', name);
      const sha = commitFile(`${name}.txt`, `${name}\n`, `Layer ${number}`);
      git('push', '-q', 'origin', `${sha}:refs/pull/${number}/head`);
    }
    // The top layer exists only on GitHub, as another person's stack does.
    git('checkout', '-q', 'stack-b');
    git('branch', '-D', 'stack-c');
    seed();
    undo = [answer('showInformationMessage', async (message: unknown) => { messages.push(String(message)); return undefined; })];
  });

  afterEach(() => {
    for (const restore of undo.reverse()) { restore(); }
    git('remote', 'remove', 'origin');
    rmSync(remote, { recursive: true, force: true });
  });

  it('goes down to the layer below and up again, to the bottom and to the top', async () => {
    await go('stackDown');
    assert.equal(here(), 'stack-a');
    await go('stackUp');
    assert.equal(here(), 'stack-b');
    await go('stackBottom');
    assert.equal(here(), 'stack-a');
    await go('stackTop');
    assert.equal(here(), 'pr/3', 'the top layer had no branch here, so it was fetched as pr/3');
    assert.equal(git('log', '-1', '--format=%s'), 'Layer 3');
  });

  it('says so at the ends of a stack, and outside of one', async () => {
    await go('stackBottom');
    await go('stackDown');
    assert.deepEqual(messages, ["'stack-a' is already at the bottom of its stack."]);
    git('checkout', '-q', 'main');
    await go('stackUp');
    assert.equal(messages[1], "'main' is not in a stack of pull requests.");
    assert.equal(here(), 'main');
    await go('stackTop');
    assert.equal(messages[2], "'main' is not in a stack of pull requests.");
  });

  it('checks out the layer picked from the stack that was right-clicked', async () => {
    const stack = await waitFor('the stack', async () =>
      (await loadTree(ctx.api)).flatMap(walk).find((node) => node.kind === 'pullRequest' && node.ref === '1' && node.children.length > 0));
    const shown: unknown[] = [];
    undo.push(answer('showQuickPick', async (items: unknown) => {
      const list = (await items) as { label: string; description: string; pull: { number: number } }[];
      shown.push(list.map((item) => [item.label, item.description]));
      return list[0];
    }));
    await vscode.commands.executeCommand('gitCheckout.pullRequests.checkoutStack', stack);
    assert.deepEqual(shown, [[
      ['$(git-pull-request) #1 Layer 1', '1 of 3'],
      ['$(git-pull-request) #2 Layer 2', '2 of 3 · checked out'],
      ['$(git-pull-request) #3 Layer 3', '3 of 3'],
    ]]);
    assert.equal(here(), 'stack-a');
  });
});
