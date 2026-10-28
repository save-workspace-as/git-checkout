import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';

import { bindExtension, git, readyTree, repoRoot, waitFor } from './harness';

describe('Apply Patch', () => {
  const ctx = bindExtension();
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'gc-patch-'));
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  /** Commits an edit, saves it as a patch, and takes the commit back out of the repository. */
  function savePatchOfAnEdit(name: string, format: 'diff' | 'format-patch'): string {
    writeFileSync(join(repoRoot(), 'notes.txt'), 'one\n');
    git('add', 'notes.txt');
    git('commit', '-m', 'add notes');
    writeFileSync(join(repoRoot(), 'notes.txt'), 'one\ntwo\n');
    git('commit', '-am', 'second line');
    // `git()` trims its output, and a patch must end with a newline.
    const patch = `${format === 'diff' ? git('diff', 'HEAD~1', 'HEAD') : git('format-patch', '--stdout', 'HEAD~1')}\n`;
    git('reset', '--hard', 'HEAD~1');
    const file = join(scratch, name);
    writeFileSync(file, patch);
    return file;
  }

  async function openForm() {
    const command = vscode.commands.executeCommand('gitCheckout.applyPatch');
    const state = await waitFor('Apply Patch form', async () => ctx.api.operationFormState());
    assert.equal(state.form.title, 'Apply Patch');
    assert.equal(state.form.values.createCommit, true);
    return { command, state };
  }

  function submit(sessionId: number, values: Record<string, string | boolean>) {
    return ctx.api.sendPanelMessage({
      type: 'operationFormMessage', sessionId, message: { type: 'formSubmit', values },
    });
  }

  it('applies a patch file to the working tree', async () => {
    await readyTree(ctx.api);
    const file = savePatchOfAnEdit('second-line.patch', 'diff');

    const { command, state } = await openForm();
    await submit(state.sessionId, { location: file, createCommit: true });
    await command;

    assert.equal(readFileSync(join(repoRoot(), 'notes.txt'), 'utf8'), 'one\ntwo\n');
    assert.match(git('status', '--porcelain'), /notes\.txt/);
  });

  it('creates the commit of a patch made by Git when Create commit is on', async () => {
    await readyTree(ctx.api);
    const file = savePatchOfAnEdit('commit.patch', 'format-patch');
    const before = git('rev-parse', 'HEAD');

    const { command, state } = await openForm();
    await submit(state.sessionId, { location: file, createCommit: true });
    await command;

    assert.notEqual(git('rev-parse', 'HEAD'), before);
    assert.equal(git('log', '-1', '--format=%s'), 'second line');
  });

  it('only changes the files when Create commit is off', async () => {
    await readyTree(ctx.api);
    const file = savePatchOfAnEdit('files.patch', 'format-patch');
    const before = git('rev-parse', 'HEAD');

    const { command, state } = await openForm();
    await submit(state.sessionId, { location: file, createCommit: false });
    await command;

    assert.equal(git('rev-parse', 'HEAD'), before);
    assert.equal(readFileSync(join(repoRoot(), 'notes.txt'), 'utf8'), 'one\ntwo\n');
  });

  it('keeps the form open and the working tree untouched when the patch does not apply', async () => {
    await readyTree(ctx.api);
    const file = savePatchOfAnEdit('stale.patch', 'diff');
    writeFileSync(join(repoRoot(), 'notes.txt'), 'something else\n');
    git('commit', '-am', 'diverge');

    const { command, state } = await openForm();
    await submit(state.sessionId, { location: file, createCommit: true });
    await waitFor('the form to report the failure', async () => ctx.api.operationFormState());

    assert.equal(readFileSync(join(repoRoot(), 'notes.txt'), 'utf8'), 'something else\n');
    assert.equal(git('status', '--porcelain'), '');
    await ctx.api.sendPanelMessage({
      type: 'operationFormMessage', sessionId: state.sessionId, message: { type: 'formCancel' },
    });
    await command;
  });

  it('rejects a location that is not a file', async () => {
    await readyTree(ctx.api);
    const { command, state } = await openForm();
    await submit(state.sessionId, { location: join(scratch, 'missing.patch'), createCommit: true });
    assert.ok(ctx.api.operationFormState(), 'the form stays open');
    await ctx.api.sendPanelMessage({
      type: 'operationFormMessage', sessionId: state.sessionId, message: { type: 'formCancel' },
    });
    await command;
  });

  it('is in the Repository dropdown', async () => {
    await readyTree(ctx.api);
    assert.ok((await vscode.commands.getCommands(true)).includes('gitCheckout.repo.0.applyPatch'));
  });

  it('still applies the patch on the clipboard', async () => {
    await readyTree(ctx.api);
    await vscode.env.clipboard.writeText(readFileSync(savePatchOfAnEdit('clip.patch', 'diff'), 'utf8'));

    await vscode.commands.executeCommand('gitCheckout.applyPatchFromClipboard');

    await waitFor('the patch to be applied', async () =>
      readFileSync(join(repoRoot(), 'notes.txt'), 'utf8') === 'one\ntwo\n' || undefined);
  });
});
