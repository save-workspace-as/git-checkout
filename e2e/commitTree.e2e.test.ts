import { strict as assert } from 'node:assert';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';

import { bindExtension, git, readyTree, repoRoot, waitFor, type RevisionRow } from './harness';

describe('Git Checkout commit file tree', () => {
  const ctx = bindExtension();

  it('loads a file at HEAD for the inline preview without opening an editor', async () => {
    await readyTree(ctx.api);
    const file = join(repoRoot(), 'tree-file.txt');
    writeFileSync(file, 'tree body\n');
    git('add', 'tree-file.txt');
    git('commit', '-m', 'add tree file');

    const editors = vscode.window.visibleTextEditors.map((editor) => editor.document.uri.toString());
    await ctx.api.sendPanelMessage({
      type: 'commitTreeOpen',
      revision: 'HEAD',
      path: 'tree-file.txt',
    });

    const document = await waitFor('revision document', async () =>
      vscode.workspace.textDocuments.find(
        (entry) => entry.uri.scheme === 'git-checkout' && entry.getText().includes('tree body'),
      ),
    );
    assert.match(document.getText(), /tree body/);
    assert.deepEqual(
      vscode.window.visibleTextEditors.map((editor) => editor.document.uri.toString()),
      editors,
    );
  });

  it('opens a file at a revision in an editor tab', async () => {
    await readyTree(ctx.api);
    writeFileSync(join(repoRoot(), 'open-me.txt'), 'at revision\n');
    git('add', 'open-me.txt');
    git('commit', '-m', 'add open-me');

    await ctx.api.sendPanelMessage({ type: 'commitTreeOpenInEditor', revision: 'HEAD', path: 'open-me.txt' });

    const editor = await waitFor('editor tab', async () =>
      vscode.window.visibleTextEditors.find(
        (entry) => entry.document.uri.scheme === 'git-checkout' && entry.document.getText().includes('at revision'),
      ),
    );
    assert.match(editor.document.getText(), /at revision/);
  });

  it('lists every file of the revision in the native File Tree, folders collapsed and first', async () => {
    mkdirSync(join(repoRoot(), 'zdir/sub'), { recursive: true });
    writeFileSync(join(repoRoot(), 'zdir/sub/deep.txt'), 'deep\n');
    writeFileSync(join(repoRoot(), 'a-top.txt'), 'top\n');
    git('add', '.');
    git('commit', '-m', 'tree files');
    await ctx.api.sendPanelMessage({ type: 'commitTreeSetRevision', revision: 'HEAD' });

    const rows = async (nodes?: RevisionRow[]): Promise<RevisionRow[]> =>
      nodes ?? ((await ctx.api.revisionLists.tree.getChildren()) as RevisionRow[]);
    await waitFor('tree listed', async () => {
      const top = await rows();
      return top.some((node) => node.path === 'zdir') ? top : undefined;
    });
    const top = await rows();
    const folders = top.filter((node) => node.kind === 'dir').map((node) => node.path);
    const firstFile = top.findIndex((node) => node.kind === 'file');
    assert.ok(top.slice(0, firstFile < 0 ? top.length : firstFile).every((node) => node.kind === 'dir'), 'folders come first');
    assert.ok(folders.includes('zdir'));

    const zdir = top.find((node) => node.path === 'zdir')!;
    const item = await ctx.api.revisionLists.tree.getTreeItem(zdir);
    assert.equal(item.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
    assert.equal(item.contextValue, 'rev.dir');
    const sub = (zdir.children ?? [])[0];
    assert.deepEqual((sub.children ?? []).map((node) => node.path), ['zdir/sub/deep.txt']);
    assert.equal(sub.revision, git('rev-parse', 'HEAD') === sub.revision ? sub.revision : 'HEAD');
  });
});
