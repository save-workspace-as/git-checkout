import { strict as assert } from 'node:assert';
import * as vscode from 'vscode';

import { answer, commitFile, menuContext } from './graphMenu';
import { bindExtension, git, readyTree, waitFor } from './harness';

describe('Graph context menu: Compare with', () => {
  const ctx = bindExtension();
  let base: string;
  let topic: string;
  let head: string;

  beforeEach(async () => {
    await readyTree(ctx.api);
    base = commitFile('base.txt', 'base\n', 'base');
    git('checkout', '-q', '-b', 'topic');
    topic = commitFile('topic.txt', 'topic\n', 'topic work');
    git('checkout', '-q', 'main');
    head = commitFile('main.txt', 'main\n', 'main work');
  });

  const shown = (sha: string) => waitFor('the comparison', async () => {
    const files = ctx.api.commitFiles();
    return files?.sha === sha && files.baseSha ? files : undefined;
  });

  it('Compare with Merge Base: shows what the commit changed since it and HEAD diverged', async () => {
    await vscode.commands.executeCommand('gitCheckout.graph.compareWithMergeBase', menuContext(topic));
    const files = await shown(topic);
    assert.equal(files.baseSha, base);
    assert.deepEqual(files.files.map((file) => file.path), ['topic.txt']);
  });

  it('Compare with HEAD: shows what changed from the commit to HEAD', async () => {
    await vscode.commands.executeCommand('gitCheckout.graph.compareWithHead', menuContext(topic));
    const files = await shown(head);
    assert.equal(files.baseSha, topic);
    assert.deepEqual(files.files.map((file) => file.path).sort(), ['main.txt', 'topic.txt']);
  });

  it('Compare with…: asks for a branch or tag, then shows the commit against it', async () => {
    git('tag', 'v-base', base);
    let offered: string[] = [];
    const restore = answer('showQuickPick', async (items) => {
      const choices = items as { name: string }[];
      offered = choices.map((choice) => choice.name);
      return choices.find((choice) => choice.name === 'v-base');
    });
    try {
      await vscode.commands.executeCommand('gitCheckout.graph.compareWithRef', menuContext(topic));
    } finally {
      restore();
    }
    assert.ok(offered.includes('topic') && offered.includes('main') && offered.includes('v-base'));
    const files = await shown(topic);
    assert.equal(files.baseSha, base);
  });

  it('Compare with Upstream: says so when the branch has none', async () => {
    const messages: string[] = [];
    const restore = answer('showWarningMessage', async (message) => { messages.push(String(message)); return undefined; });
    try {
      await vscode.commands.executeCommand('gitCheckout.graph.compareWithUpstream', menuContext(topic, { graphBranch: 'topic', graphBranchKind: 'local' }));
    } finally {
      restore();
    }
    assert.deepEqual(messages, ['topic has no upstream branch to compare with.']);
  });
});
