import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';

import { commitFile } from './graphMenu';
import { bindExtension, git, readyTree, repoRoot, waitFor } from './harness';

describe('Graph visibility settings', () => {
  const ctx = bindExtension();
  const settings = ['showStashes', 'showRemoteBranches', 'showTags'] as const;

  const set = async (name: (typeof settings)[number], value: boolean | undefined): Promise<void> => {
    await vscode.workspace.getConfiguration('gitCheckout').update(`graph.${name}`, value, vscode.ConfigurationTarget.Global);
  };

  afterEach(async () => {
    for (const name of settings) { await set(name, undefined); }
  });

  /** `main` with a stash, a tag, and a remote-tracking branch on a commit that only it reaches. */
  async function seed(): Promise<void> {
    await readyTree(ctx.api);
    commitFile('f.txt', 'base\n', 'base');
    git('checkout', '-q', '-b', 'side');
    git('commit', '--allow-empty', '-m', 'only-remote');
    git('update-ref', 'refs/remotes/origin/side', 'HEAD');
    git('checkout', '-q', 'main');
    git('branch', '-D', 'side');
    git('tag', 'v-seed');
    writeFileSync(join(repoRoot(), 'f.txt'), 'changed\n');
    git('stash', 'push', '-m', 'wip');
  }

  const labels = async (): Promise<string[]> => (await ctx.api.graphCommits()).flatMap((commit) => commit.refs);
  const subjects = async (): Promise<string[]> => (await ctx.api.graphCommits()).map((commit) => commit.subject);
  const settled = async (what: string, probe: () => Promise<boolean>): Promise<void> => {
    await waitFor(what, async () => ((await probe()) ? true : undefined));
  };

  it('shows stashes, remote branches and tags by default', async () => {
    await seed();
    assert.ok((await labels()).includes('tag:v-seed'));
    assert.ok((await labels()).includes('remote:origin/side'));
    assert.ok((await labels()).includes('stash:stash@{0}'));
    assert.ok((await subjects()).includes('only-remote'));
  });

  it('leaves tags out of the graph while the setting is off, and brings them back when it is on again', async () => {
    await seed();
    await set('showTags', false);
    await settled('tags to leave the graph', async () => !(await labels()).includes('tag:v-seed'));
    assert.ok((await labels()).includes('remote:origin/side'), 'other labels stay');
    await set('showTags', true);
    await settled('tags to return', async () => (await labels()).includes('tag:v-seed'));
  });

  it('leaves remote branches out, together with commits only they reach', async () => {
    await seed();
    await set('showRemoteBranches', false);
    // One read of the graph answers both, so the label and its commit cannot be seen out of step.
    await settled('remote branches and their commits to leave', async () => {
      const commits = await ctx.api.graphCommits();
      return !commits.some((commit) => commit.refs.includes('remote:origin/side') || commit.subject === 'only-remote');
    });
    assert.ok((await labels()).includes('tag:v-seed'));
    await set('showRemoteBranches', true);
    await settled('remote branches to return', async () => (await subjects()).includes('only-remote'));
  });

  it('leaves stashes out, and brings them back', async () => {
    await seed();
    await set('showStashes', false);
    await settled('stashes and their commits to leave', async () => {
      const commits = await ctx.api.graphCommits();
      return !commits.some((commit) => commit.refs.includes('stash:stash@{0}') || commit.subject.includes('wip'));
    });
    await set('showStashes', true);
    await settled('stashes to return', async () => (await labels()).includes('stash:stash@{0}'));
  });
});
