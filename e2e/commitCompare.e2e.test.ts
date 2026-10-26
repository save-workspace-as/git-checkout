import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';

import { bindExtension, git, repoRoot, waitFor } from './harness';

describe('Compare two selected commits', () => {
  const ctx = bindExtension();

  it('opens a file diff from the older commit to the newer one', async () => {
    const commitFile = (content: string, message: string): string => {
      writeFileSync(join(repoRoot(), 'compare.txt'), content);
      git('add', 'compare.txt');
      git('commit', '-m', message);
      return git('rev-parse', 'HEAD');
    };
    const older = commitFile('first\n', 'first');
    commitFile('second\n', 'second');
    const newer = commitFile('third\n', 'third');

    await ctx.api.sendPanelMessage({
      type: 'commitDetailsOpenFile',
      sha: newer,
      baseSha: older,
      path: 'compare.txt',
      status: 'M',
    });

    const input = await waitFor('compare diff tab', async () => {
      const tab = vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .find((entry) => entry.input instanceof vscode.TabInputTextDiff);
      return tab?.input as vscode.TabInputTextDiff | undefined;
    });
    const [left, right] = await Promise.all([
      vscode.workspace.openTextDocument(input.original),
      vscode.workspace.openTextDocument(input.modified),
    ]);
    assert.equal(left.getText(), 'first\n');
    assert.equal(right.getText(), 'third\n');
  });
});
