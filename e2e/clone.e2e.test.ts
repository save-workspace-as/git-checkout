import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { bindExtension, waitFor } from './harness';

function sourceRepository(): string {
  const source = mkdtempSync(join(tmpdir(), 'git-checkout-clone-source-'));
  const run = (...args: string[]): string =>
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd: source, encoding: 'utf8' });
  run('init', '-b', 'main');
  writeFileSync(join(source, 'hello.txt'), 'hello');
  run('add', '.');
  run('commit', '-m', 'first');
  return source;
}

describe('Clone', () => {
  const ctx = bindExtension();

  it('clones a repository into the chosen folder', async () => {
    const source = sourceRepository();
    const location = mkdtempSync(join(tmpdir(), 'git-checkout-clone-dest-'));
    await vscode.commands.executeCommand('gitCheckout.clone', { url: source, location });
    const target = join(location, source.split(/[\\/]/).pop() ?? '');
    assert.ok(existsSync(join(target, 'hello.txt')));
    assert.equal(execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: target, encoding: 'utf8' }).trim(), 'main');
  });

  it('asks for a URL and a folder, with no account', async () => {
    const command = vscode.commands.executeCommand('gitCheckout.clone');
    const state = await waitFor('clone form', async () => ctx.api.operationFormState());
    assert.equal(state.form.title, 'Clone');
    assert.deepEqual(state.form.fields.map((field) => field.id), ['url', 'location']);
    const source = sourceRepository();
    const location = mkdtempSync(join(tmpdir(), 'git-checkout-clone-form-'));
    await ctx.api.sendPanelMessage({
      type: 'operationFormMessage', sessionId: state.sessionId,
      message: { type: 'formSubmit', values: { url: source, location } },
    });
    await command;
    const target = join(location, source.split(/[\\/]/).pop() ?? '');
    await waitFor('cloned files', async () => existsSync(join(target, 'hello.txt')) || undefined);
  });

  it('leaves nothing behind when the form is canceled', async () => {
    const command = vscode.commands.executeCommand('gitCheckout.clone');
    const state = await waitFor('clone form', async () => ctx.api.operationFormState());
    await ctx.api.sendPanelMessage({
      type: 'operationFormMessage', sessionId: state.sessionId, message: { type: 'formCancel' },
    });
    await command;
    assert.equal(ctx.api.operationFormState(), undefined);
  });

  it('refuses a folder that already has files', async () => {
    const source = sourceRepository();
    const location = mkdtempSync(join(tmpdir(), 'git-checkout-clone-taken-'));
    const name = source.split(/[\\/]/).pop() ?? '';
    execFileSync('git', ['clone', source, join(location, name)]);
    await vscode.commands.executeCommand('gitCheckout.clone', { url: source, location });
    assert.equal(ctx.api.operationFormState(), undefined);
    assert.equal(execFileSync('git', ['log', '--oneline'], { cwd: join(location, name), encoding: 'utf8' }).trim().split('\n').length, 1);
  });
});
