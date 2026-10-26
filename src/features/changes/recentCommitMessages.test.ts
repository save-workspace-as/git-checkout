import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import type * as vscode from 'vscode';

import { addRecentCommitMessage, getRecentCommitMessages } from './recentCommitMessages';

function createMockContext(): vscode.ExtensionContext {
  const store = new Map<string, unknown>();
  return {
    globalState: {
      get: <T>(key: string, defaultValue: T) => (store.get(key) as T | undefined) ?? defaultValue,
      update: async (key: string, value: unknown) => {
        store.set(key, value);
      },
      keys: () => [...store.keys()],
      setKeysForSync: () => {},
    },
  } as unknown as vscode.ExtensionContext;
}

describe('recentCommitMessages', () => {
  it('dedupes and caps stored messages', async () => {
    const context = createMockContext();
    await addRecentCommitMessage(context, 'first');
    await addRecentCommitMessage(context, 'second');
    await addRecentCommitMessage(context, 'first');

    assert.deepEqual(getRecentCommitMessages(context), ['first', 'second']);
  });

  it('ignores blank messages', async () => {
    const context = createMockContext();
    await addRecentCommitMessage(context, '   ');
    assert.deepEqual(getRecentCommitMessages(context), []);
  });
});
