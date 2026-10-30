import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';

import { commitFile } from './graphMenu';
import { bindExtension, git, readyTree, repoRoot, waitFor } from './harness';

describe('Line blame', () => {
  const ctx = bindExtension();
  let first = '';
  let second = '';

  beforeEach(async () => {
    await readyTree(ctx.api);
    first = commitFile('story.txt', 'one\ntwo\nthree\n', 'start the story');
    second = commitFile('story.txt', 'one\nTWO\nthree\n', 'shout the second line (#7)');
  });

  afterEach(async () => {
    await vscode.workspace.getConfiguration('gitCheckout').update('blame.inline.enabled', undefined, vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  async function openAt(line: number): Promise<vscode.TextEditor> {
    const document = await vscode.workspace.openTextDocument(join(repoRoot(), 'story.txt'));
    const editor = await vscode.window.showTextDocument(document);
    const position = new vscode.Position(line, 0);
    editor.selection = new vscode.Selection(position, position);
    return editor;
  }

  it('follows the cursor and says which commit last changed the line', async () => {
    await openAt(0);
    const onFirst = await waitFor('blame of line 1', async () => {
      const blame = ctx.api.lineBlame();
      return blame?.sha === first ? blame : undefined;
    });
    assert.match(onFirst.text, /start the story/);

    await openAt(1);
    const onSecond = await waitFor('blame of line 2', async () => {
      const blame = ctx.api.lineBlame();
      return blame?.sha === second ? blame : undefined;
    });
    assert.match(onSecond.text, /shout the second line/);
  });

  it('reads a line that is typed and not saved as not committed, and the others as before', async () => {
    const editor = await openAt(2);
    await editor.edit((edit) => edit.insert(new vscode.Position(2, 0), 'very '));
    const typed = await waitFor('blame of the typed line', async () => {
      const blame = ctx.api.lineBlame();
      return blame && blame.sha !== first && blame.sha !== second ? blame : undefined;
    });
    assert.match(typed.sha, /^0+$/);
    assert.match(typed.text, /uncommitted/i);
    assert.equal(git('status', '--porcelain'), '', 'blame did not touch the working tree');
  });

  it('copies the hash of the line, and Toggle Inline Blame turns the text off and on', async () => {
    await openAt(1);
    await waitFor('blame of line 2', async () => (ctx.api.lineBlame()?.sha === second ? true : undefined));
    await vscode.commands.executeCommand('gitCheckout.blame.copyHash');
    assert.equal(await vscode.env.clipboard.readText(), second);

    const inline = (): boolean => vscode.workspace.getConfiguration('gitCheckout').get<boolean>('blame.inline.enabled', true);
    assert.equal(inline(), true);
    await vscode.commands.executeCommand('gitCheckout.blame.toggleInline');
    assert.equal(inline(), false);
    await vscode.commands.executeCommand('gitCheckout.blame.toggleInline');
    assert.equal(inline(), true);
  });

  it('opens the change the commit made in the Commit tab, not in an editor', async () => {
    await openAt(1);
    await waitFor('blame of line 2', async () => (ctx.api.lineBlame()?.sha === second ? true : undefined));
    const editors = vscode.window.tabGroups.all.flatMap((group) => group.tabs).length;
    await vscode.commands.executeCommand('gitCheckout.blame.openChanges');
    const shown = await waitFor('the file in the Commit tab', async () => {
      const files = ctx.api.commitFiles();
      return files?.sha === second && files.shownPath === 'story.txt' ? files : undefined;
    });
    assert.deepEqual(shown.files.map((file) => file.path), ['story.txt']);
    const diffs = vscode.window.tabGroups.all.flatMap((group) => group.tabs).filter((tab) => tab.input instanceof vscode.TabInputTextDiff);
    assert.equal(diffs.length, 0, 'no diff editor opened');
    assert.ok(vscode.window.tabGroups.all.flatMap((group) => group.tabs).length >= editors);
  });

  it('has nothing to say about a file git does not know', async () => {
    writeFileSync(join(repoRoot(), 'untracked.txt'), 'x\n');
    const document = await vscode.workspace.openTextDocument(join(repoRoot(), 'untracked.txt'));
    await vscode.window.showTextDocument(document);
    await waitFor('the blame to go', async () => (ctx.api.lineBlame() === undefined ? true : undefined));
  });
});
