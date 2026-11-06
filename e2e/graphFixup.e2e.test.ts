import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';

import { answer, cancelForm, commitFile, menuContext, submitForm } from './graphMenu';
import { bindExtension, git, readyTree, repoRoot } from './harness';

describe('Graph context menu: Fixup and Squash into Parent', () => {
  const ctx = bindExtension();
  let second: string;

  beforeEach(async () => {
    await readyTree(ctx.api);
    commitFile('a.txt', 'a\n', 'first');
    second = commitFile('b.txt', 'b\n', 'second');
    commitFile('c.txt', 'c\n', 'third');
  });

  it('Fixup into This Commit…: folds the staged change into the commit, after a form', async () => {
    writeFileSync(join(repoRoot(), 'b.txt'), 'b, fixed\n');
    git('add', 'b.txt');
    const command = vscode.commands.executeCommand('gitCheckout.graph.fixup', menuContext(second));
    await submitForm(ctx.api, command, 'Fixup');
    assert.equal(git('log', '--format=%s'), 'third\nsecond\nfirst\ninit');
    assert.equal(git('show', 'HEAD~1:b.txt'), 'b, fixed');
    assert.equal(git('status', '--porcelain'), '');
  });

  it('Fixup into This Commit…: canceling the form changes nothing', async () => {
    writeFileSync(join(repoRoot(), 'b.txt'), 'b, fixed\n');
    git('add', 'b.txt');
    const head = git('rev-parse', 'HEAD');
    const command = vscode.commands.executeCommand('gitCheckout.graph.fixup', menuContext(second));
    await cancelForm(ctx.api, command, 'Fixup');
    assert.equal(git('rev-parse', 'HEAD'), head);
    assert.equal(git('status', '--porcelain'), 'M  b.txt');
  });

  it('Fixup into This Commit…: asks to stage something first when nothing is staged', async () => {
    const messages: string[] = [];
    const restore = answer('showWarningMessage', async (message) => { messages.push(String(message)); return undefined; });
    try {
      await vscode.commands.executeCommand('gitCheckout.graph.fixup', menuContext(second));
    } finally {
      restore();
    }
    assert.deepEqual(messages, ['Stage the changes to fold into the commit first.']);
    assert.equal(ctx.api.operationFormState(), undefined);
  });

  it('Squash into Parent…: melts the commit into its parent under the message from the form', async () => {
    const command = vscode.commands.executeCommand('gitCheckout.graph.squashIntoParent', menuContext(second));
    await submitForm(ctx.api, command, 'Squash into Parent', { message: 'first and second' });
    assert.equal(git('log', '--format=%s'), 'third\nfirst and second\ninit');
    assert.equal(git('status', '--porcelain'), '');
  });

  it('Squash into Parent…: says so for the first commit, which has no parent', async () => {
    const messages: string[] = [];
    const restore = answer('showWarningMessage', async (message) => { messages.push(String(message)); return undefined; });
    try {
      await vscode.commands.executeCommand('gitCheckout.graph.squashIntoParent', menuContext(git('rev-list', '--max-parents=0', 'HEAD')));
    } finally {
      restore();
    }
    assert.deepEqual(messages, ['The first commit of the history has no parent to squash into.']);
  });

  it('Split Commit…: takes the commit apart in the middle of a rebase, and the rest follows once it is committed in parts', async () => {
    writeFileSync(join(repoRoot(), 'd.txt'), 'd\n');
    writeFileSync(join(repoRoot(), 'e.txt'), 'e\n');
    git('add', 'd.txt', 'e.txt');
    git('commit', '-m', 'both');
    const both = git('rev-parse', 'HEAD');
    commitFile('f.txt', 'f\n', 'after');
    const command = vscode.commands.executeCommand('gitCheckout.graph.split', menuContext(both));
    await submitForm(ctx.api, command, 'Split Commit');
    assert.equal(git('status', '--porcelain').split('\n').sort().join('|'), '?? d.txt|?? e.txt');
    git('add', 'd.txt');
    git('commit', '-m', 'only d');
    git('add', 'e.txt');
    git('commit', '-m', 'only e');
    git('rebase', '--continue');
    assert.equal(git('log', '--format=%s', '-4'), 'after\nonly e\nonly d\nthird');
  });

  it('Split Commit…: asks to commit or stash first when the working tree has changes', async () => {
    writeFileSync(join(repoRoot(), 'b.txt'), 'edited\n');
    const messages: string[] = [];
    const restore = answer('showWarningMessage', async (message) => { messages.push(String(message)); return undefined; });
    try {
      await vscode.commands.executeCommand('gitCheckout.graph.split', menuContext(second));
    } finally {
      restore();
    }
    assert.deepEqual(messages, ['Commit or stash your changes before splitting a commit.']);
  });
});
