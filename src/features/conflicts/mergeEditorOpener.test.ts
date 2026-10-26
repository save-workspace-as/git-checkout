import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Uri } from 'vscode';
import { openFileInMergeEditor } from './mergeEditorOpener';

const fileUri = { fsPath: '/repo/a.ts' } as Uri;

describe('mergeEditorOpener', () => {
  it('tries merge editor commands until one succeeds', async () => {
    const calls: string[] = [];
    const ok = await openFileInMergeEditor(fileUri, async (command) => {
      calls.push(command);
      if (command === 'git.openMergeEditor') {
        return;
      }
      throw new Error('missing');
    });
    assert.equal(ok, true);
    assert.deepEqual(calls, ['git.openMergeEditor']);
  });

  it('returns false when no command is available', async () => {
    const ok = await openFileInMergeEditor(fileUri, async () => {
      throw new Error('unavailable');
    });
    assert.equal(ok, false);
  });
});
