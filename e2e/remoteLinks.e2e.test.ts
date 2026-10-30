import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';

import { answer, commitFile, menuContext } from './graphMenu';
import { bindExtension, git, loadTree, readyTree, repoRoot, waitFor, type SidebarNode } from './harness';

describe('Open on GitHub', () => {
  const ctx = bindExtension();
  const opened: string[] = [];
  const warnings: string[] = [];
  let undo: (() => void)[] = [];
  let head = '';

  beforeEach(async () => {
    await readyTree(ctx.api);
    opened.length = 0;
    warnings.length = 0;
    git('remote', 'add', 'origin', 'https://github.com/octo/app.git');
    head = commitFile('story.txt', 'one\ntwo\nthree\nfour\n', 'write a story');
    const env = vscode.env as unknown as { openExternal: (uri: vscode.Uri) => Thenable<boolean> };
    const original = env.openExternal;
    env.openExternal = async (uri) => { opened.push(uri.toString()); return true; };
    undo = [() => { env.openExternal = original; }, answer('showWarningMessage', async (message: unknown) => { warnings.push(String(message)); return undefined; })];
    await vscode.env.clipboard.writeText('');
  });

  afterEach(async () => {
    for (const restore of undo) { restore(); }
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  async function select(first: number, last: number): Promise<void> {
    const document = await vscode.workspace.openTextDocument(join(repoRoot(), 'story.txt'));
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(first - 1, 0, last - 1, 2);
  }

  it('copies a link to the selected lines on the branch while the commit is not pushed, and on the commit once it is', async () => {
    await select(2, 3);
    await vscode.commands.executeCommand('gitCheckout.remote.copyFileLink');
    assert.equal(await vscode.env.clipboard.readText(), 'https://github.com/octo/app/blob/main/story.txt#L2-L3');

    git('update-ref', 'refs/remotes/origin/main', head);
    await select(4, 4);
    await vscode.commands.executeCommand('gitCheckout.remote.copyFileLink');
    assert.equal(await vscode.env.clipboard.readText(), `https://github.com/octo/app/blob/${head}/story.txt#L4`);
  });

  it('opens the file, and the repository and a commit, in the browser', async () => {
    await select(1, 1);
    await vscode.commands.executeCommand('gitCheckout.remote.openFile');
    await vscode.commands.executeCommand('gitCheckout.remote.openRepository');
    await vscode.commands.executeCommand('gitCheckout.graph.openOnGitHub', menuContext(head));
    assert.deepEqual(opened, [
      'https://github.com/octo/app/blob/main/story.txt#L1',
      'https://github.com/octo/app',
      `https://github.com/octo/app/commit/${head}`,
    ]);
    await vscode.commands.executeCommand('gitCheckout.graph.copyGitHubLink', menuContext(head));
    assert.equal(await vscode.env.clipboard.readText(), `https://github.com/octo/app/commit/${head}`);
  });

  it('says so, and leaves the clipboard alone, for a file git does not track or a repository that is not on GitHub', async () => {
    writeFileSync(join(repoRoot(), 'loose.txt'), 'x\n');
    const loose = vscode.Uri.file(join(repoRoot(), 'loose.txt'));
    await vscode.commands.executeCommand('gitCheckout.remote.copyFileLink', loose);
    assert.match(warnings.at(-1) ?? '', /not tracked/);

    git('remote', 'set-url', 'origin', 'https://example.test/octo/app.git');
    await vscode.commands.executeCommand('gitCheckout.remote.copyFileLink', vscode.Uri.file(join(repoRoot(), 'story.txt')));
    assert.match(warnings.at(-1) ?? '', /no GitHub remote/);
    assert.equal(await vscode.env.clipboard.readText(), '');
    assert.deepEqual(opened, []);
  });

  it('opens a remote from the sidebar in the browser, whether it is set up with SSH or HTTPS', async () => {
    git('remote', 'add', 'work', 'git@git.example.com:team/app.git');
    git('remote', 'add', 'plain', 'https://user:secret@code.example.com/team/lib.git');
    git('remote', 'add', 'local', repoRoot());
    const remotes = await waitFor('the remotes in the sidebar', async () => {
      const nodes = (await loadTree(ctx.api)).flatMap(function walk(node: SidebarNode): SidebarNode[] {
        return [node, ...(node.children ?? []).flatMap(walk)];
      }).filter((node) => node.kind === 'remote');
      return nodes.length >= 4 ? nodes : undefined;
    });
    for (const name of ['work', 'plain', 'local']) {
      await vscode.commands.executeCommand('gitCheckout.sidebar.openRemote', remotes.find((node) => node.ref === name));
    }
    assert.deepEqual(opened, ['https://git.example.com/team/app', 'https://code.example.com/team/lib']);
    assert.match(warnings.at(-1) ?? '', /remote 'local' has no web page/);
  });
});
