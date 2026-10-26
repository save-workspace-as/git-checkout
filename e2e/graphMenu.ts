import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';

import { git, repoRoot, waitFor, type bindExtension } from './harness';

type Api = ReturnType<typeof bindExtension>['api'];

export function gitIn(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'protocol.file.allow=always', ...args], { cwd, encoding: 'utf8' }).trim();
}

/** What the graph's native menu hands a command: the row's context, plus the branch the submenu points at. */
export function menuContext(sha: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    webviewSection: 'commit',
    graphSelection: 'single',
    sha,
    subject: git('log', '-1', '--format=%s', sha),
    shas: [sha],
    preventDefaultContextMenuItems: true,
    ...extra,
  };
}

export function branchContext(branch: string, kind: 'local' | 'remote' = 'local'): Record<string, unknown> {
  return menuContext(git('rev-parse', branch), { graphBranch: branch, graphBranchKind: kind });
}

export function commitFile(name: string, text: string, message: string): string {
  writeFileSync(join(repoRoot(), name), text);
  git('add', name);
  git('commit', '-m', message);
  return git('rev-parse', 'HEAD');
}

/** Submits the modal that a command opened, with `values` over its defaults, and waits for the command. */
export async function submitForm(api: Api, command: Thenable<unknown>, title: string, values: Record<string, string | boolean> = {}): Promise<void> {
  const state = await waitFor(`${title} modal`, async () => api.operationFormState());
  assert.equal(state.form.title, title);
  await api.sendPanelMessage({
    type: 'operationFormMessage', sessionId: state.sessionId,
    message: { type: 'formSubmit', values: { ...state.form.values, ...values } },
  });
  await command;
}

export async function cancelForm(api: Api, command: Thenable<unknown>, title: string): Promise<Record<string, string | boolean>> {
  const state = await waitFor(`${title} modal`, async () => api.operationFormState());
  assert.equal(state.form.title, title);
  await api.sendPanelMessage({
    type: 'operationFormMessage', sessionId: state.sessionId, message: { type: 'formCancel' },
  });
  await command;
  return state.form.values;
}


/** Replaces a `vscode.window` prompt for one test, so a native dialog answers itself. */
export function answer<K extends 'showQuickPick' | 'showErrorMessage' | 'showWarningMessage' | 'showInformationMessage' | 'showSaveDialog' | 'showInputBox'>(
  name: K, reply: (...args: unknown[]) => unknown,
): () => void {
  const target = vscode.window as unknown as Record<string, unknown>;
  const original = target[name];
  target[name] = reply;
  return () => { target[name] = original; };
}

