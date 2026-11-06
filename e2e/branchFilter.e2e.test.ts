import { strict as assert } from 'node:assert';
import * as vscode from 'vscode';

import { answer, commitFile } from './graphMenu';
import { bindExtension, branchesOf, findByRef, git, loadTree, readyTree, waitFor } from './harness';

describe('Filter branches', () => {
  const ctx = bindExtension();
  const undo: (() => void)[] = [];

  /** Which of the test's own branches the sidebar lists; other tests leave branches of theirs behind. */
  const names = async (): Promise<string[]> => {
    const tree = await loadTree(ctx.api);
    return ['main', 'mine', 'theirs'].filter((name) => findByRef(branchesOf(tree), name));
  };
  const filter = async (value?: string): Promise<void> => { await vscode.commands.executeCommand('gitCheckout.sidebar.filterBranches', value); };
  const showing = (expected: string[]) => waitFor(`the branches ${expected.join(', ')}`, async () => {
    const now = (await names()).sort();
    return now.join() === [...expected].sort().join() ? now : undefined;
  });

  beforeEach(async () => {
    await readyTree(ctx.api);
    commitFile('base.txt', 'base\n', 'base');
    git('checkout', '-q', '-b', 'mine');
    commitFile('mine.txt', 'mine\n', 'mine');
    git('checkout', '-q', 'main');
    git('checkout', '-q', '-b', 'theirs');
    git('-c', 'user.email=other@example.com', '-c', 'user.name=Other', 'commit', '--allow-empty', '-m', 'theirs');
    git('checkout', '-q', 'main');
  });

  afterEach(async () => {
    await filter('all');
    for (const restore of undo.splice(0)) { restore(); }
    git('branch', '-D', 'mine', 'theirs');
  });

  it('lists only the branches with your commits, then all of them again', async () => {
    await showing(['main', 'mine', 'theirs']);
    await filter('mine');
    await showing(['main', 'mine']);
    await filter('all');
    await showing(['main', 'mine', 'theirs']);
  });

  it('leaves the other branches out of the graph too, and brings them back with All', async () => {
    const labels = async (): Promise<string[]> => (await ctx.api.graphCommits()).flatMap((commit) => commit.refs);
    const has = (refs: string[], name: string): boolean => refs.includes(`local:${name}`);
    await waitFor('both branches in the graph', async () => { const refs = await labels(); return has(refs, 'mine') && has(refs, 'theirs') ? refs : undefined; });
    await filter('mine');
    await waitFor('only your branches in the graph', async () => { const refs = await labels(); return has(refs, 'mine') && !has(refs, 'theirs') ? refs : undefined; });
    await filter('all');
    await waitFor('every branch in the graph again', async () => { const refs = await labels(); return has(refs, 'theirs') ? refs : undefined; });
  });

  it('asks which branches to show, and keeps the choice until it is changed', async () => {
    const asked: string[] = [];
    undo.push(answer('showQuickPick', (items: unknown) => {
      const list = items as { label: string }[];
      asked.push(...list.map((item) => item.label));
      return list.find((item) => item.label === 'Yours');
    }));
    await filter();
    assert.deepEqual(asked, ['All branches', 'Yours', 'Active', 'Stale']);
    await showing(['main', 'mine']);
    const description = (await loadTree(ctx.api)).find((node) => node.id === 'section:branches')?.description;
    assert.match(description ?? '', /^Yours · \d+$/);
  });

  it('shows what changed lately as active, and the rest as stale', async () => {
    await filter('active');
    await showing(['main', 'mine', 'theirs']);
    await filter('stale');
    await showing(['main']);
  });
});
