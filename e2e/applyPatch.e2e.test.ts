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

  describe('Create Patch', () => {
    function openCreateForm(options: { revision?: string; saveTo: string }) {
      return vscode.commands.executeCommand('gitCheckout.createPatch', options);
    }

    async function commitTwoEdits(): Promise<void> {
      writeFileSync(join(repoRoot(), 'notes.txt'), 'one\n');
      git('add', 'notes.txt');
      git('commit', '-m', 'add notes');
      writeFileSync(join(repoRoot(), 'notes.txt'), 'one\ntwo\n');
      git('commit', '-am', 'second line');
    }

    it('saves the commit as a patch that applies elsewhere', async () => {
      await readyTree(ctx.api);
      await commitTwoEdits();
      const saveTo = join(scratch, 'out.patch');

      const command = openCreateForm({ saveTo });
      const state = await waitFor('Create Patch form', async () => ctx.api.operationFormState());
      assert.equal(state.form.title, 'Create Patch');
      assert.equal(state.form.values.revision, 'HEAD');
      await submit(state.sessionId, { revision: 'HEAD', format: 'format-patch' });
      await command;

      const patch = readFileSync(saveTo, 'utf8');
      assert.match(patch, /^Subject: \[PATCH\] second line$/m);
      git('reset', '--hard', 'HEAD~1');
      git('am', saveTo);
      assert.equal(git('log', '-1', '--format=%s'), 'second line');
    });

    it('saves a plain diff of a range', async () => {
      await readyTree(ctx.api);
      await commitTwoEdits();
      const saveTo = join(scratch, 'out.diff');

      const command = openCreateForm({ revision: 'HEAD~1..HEAD', saveTo });
      const state = await waitFor('Create Patch form', async () => ctx.api.operationFormState());
      assert.equal(state.form.values.revision, 'HEAD~1..HEAD');
      await submit(state.sessionId, { revision: 'HEAD~1..HEAD', format: 'diff' });
      await command;

      const diff = readFileSync(saveTo, 'utf8');
      assert.match(diff, /^diff --git a\/notes\.txt b\/notes\.txt$/m);
      assert.doesNotMatch(diff, /^Subject:/m);
    });

    it('keeps the form open and writes nothing for a revision that does not exist', async () => {
      await readyTree(ctx.api);
      const saveTo = join(scratch, 'none.patch');

      const command = openCreateForm({ saveTo });
      const state = await waitFor('Create Patch form', async () => ctx.api.operationFormState());
      await submit(state.sessionId, { revision: 'no-such-ref', format: 'format-patch' });
      await waitFor('the form to report the failure', async () => ctx.api.operationFormState());

      assert.throws(() => readFileSync(saveTo), /ENOENT/);
      await ctx.api.sendPanelMessage({
        type: 'operationFormMessage', sessionId: state.sessionId, message: { type: 'formCancel' },
      });
      await command;
    });

    it('opens for the graph\'s Save as Patch with the commit and format filled in', async () => {
      await readyTree(ctx.api);
      await commitTwoEdits();
      const sha = git('rev-parse', 'HEAD');

      const handled = ctx.api.sendPanelMessage({ type: 'historyPatchExport', shas: [sha], op: 'save', format: 'diff' });
      const state = await waitFor('Create Patch form', async () => ctx.api.operationFormState());

      assert.equal(state.form.title, 'Create Patch');
      assert.equal(state.form.values.revision, sha);
      assert.equal(state.form.values.format, 'diff');
      await ctx.api.sendPanelMessage({
        type: 'operationFormMessage', sessionId: state.sessionId, message: { type: 'formCancel' },
      });
      await handled;
    });

    it('spans several selected commits as one range', async () => {
      await readyTree(ctx.api);
      await commitTwoEdits();
      const newest = git('rev-parse', 'HEAD');
      const oldest = git('rev-parse', 'HEAD~1');

      const handled = ctx.api.sendPanelMessage({ type: 'historyPatchExport', shas: [newest, oldest], op: 'save', format: 'format-patch' });
      const state = await waitFor('Create Patch form', async () => ctx.api.operationFormState());

      assert.equal(state.form.values.revision, `${oldest}^..${newest}`);
      await ctx.api.sendPanelMessage({
        type: 'operationFormMessage', sessionId: state.sessionId, message: { type: 'formCancel' },
      });
      await handled;
    });

    it('is in the Repository dropdown', async () => {
      await readyTree(ctx.api);
      assert.ok((await vscode.commands.getCommands(true)).includes('gitCheckout.repo.0.createPatch'));
    });
  });
});
