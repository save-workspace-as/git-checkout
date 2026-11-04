import { strict as assert } from 'node:assert';
import * as vscode from 'vscode';

import { answer, commitFile, menuContext } from './graphMenu';
import { bindExtension, readyTree, repoRoot, resetToRepository, waitFor } from './harness';

describe('Explain Commit with AI', () => {
  const ctx = bindExtension();
  const prompts: string[] = [];
  const messages: string[] = [];
  let undo: (() => void)[] = [];

  beforeEach(async () => {
    await readyTree(ctx.api);
    await resetToRepository(ctx.api, repoRoot());
    prompts.length = 0;
    messages.length = 0;
    undo = [
      answer('showInformationMessage', async (message: unknown) => { messages.push(String(message)); return undefined; }),
      answer('showWarningMessage', async (message: unknown) => { messages.push(String(message)); return undefined; }),
      answer('showErrorMessage', async (message: unknown) => { messages.push(String(message)); return undefined; }),
    ];
    ctx.api.seedLanguageModel(async (prompt) => { prompts.push(prompt); return '**Summary.** It adds the explained file.\n\n- `explained.txt` is new'; });
  });

  afterEach(async () => {
    ctx.api.seedLanguageModel(undefined);
    for (const restore of undo.reverse()) { restore(); }
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  it('shows the explanation of the commit that was right-clicked as a Markdown document beside the graph', async () => {
    const sha = commitFile('explained.txt', 'hello\n', 'feat: add the explained file');
    await vscode.commands.executeCommand('gitCheckout.graph.explain', menuContext(sha));
    const document = await waitFor('the explanation', async () =>
      vscode.workspace.textDocuments.find((candidate) => candidate.languageId === 'markdown' && candidate.getText().includes('It adds the explained file')),
    );
    assert.ok(document.getText().startsWith(`# ${sha.slice(0, 7)} feat: add the explained file\n\n**Summary.**`));
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /Commit message:\nfeat: add the explained file/);
    assert.match(prompts[0], /\+\+\+ b\/explained\.txt/);
  });

  it('says so when the model fails, and opens nothing', async () => {
    ctx.api.seedLanguageModel(async () => { throw new Error('quota used up'); });
    const sha = commitFile('other.txt', 'x\n', 'feat: other');
    const before = vscode.workspace.textDocuments.filter((candidate) => candidate.languageId === 'markdown').length;
    await vscode.commands.executeCommand('gitCheckout.graph.explain', menuContext(sha));
    await waitFor('the message', async () => (messages.some((message) => /Could not explain the commit: quota used up/.test(message)) ? true : undefined));
    assert.equal(vscode.workspace.textDocuments.filter((candidate) => candidate.languageId === 'markdown').length, before);
  });
});
