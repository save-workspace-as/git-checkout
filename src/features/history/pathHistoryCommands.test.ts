import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

interface MenuEntry {
  command: string;
  when?: string;
}

const { contributes } = JSON.parse(
  readFileSync(join(__dirname, '../../../package.json'), 'utf8'),
) as {
  contributes: { commands: { command: string }[]; menus: Record<string, MenuEntry[]> };
};

const declared = new Set(contributes.commands.map((command) => command.command));

describe('path history commands', () => {
  it('opens file, directory, and hunk history from the file tree', () => {
    for (const id of [
      'gitCheckout.pathHistory.file',
      'gitCheckout.pathHistory.directory',
      'gitCheckout.pathHistory.hunk',
    ]) {
      assert.ok(declared.has(id), id);
    }

    const rows = contributes.menus['view/item/context'];
    const webview = contributes.menus['webview/context'];
    const file = rows.find((entry) => entry.command === 'gitCheckout.file.history');
    const directory = rows.find((entry) => entry.command === 'gitCheckout.pathHistory.directory');
    assert.match(file?.when ?? '', /viewItem == rev\.file/);
    assert.match(directory?.when ?? '', /viewItem == rev\.dir/);
    assert.equal(webview.some((entry) => entry.command === 'gitCheckout.pathHistory.hunk'), false);

    const explorer = contributes.menus['explorer/context'];
    assert.equal(explorer.some((entry) => entry.command === 'gitCheckout.pathHistory.hunk'), false);
    assert.ok(
      explorer.some(
        (entry) =>
          entry.command === 'gitCheckout.pathHistory.directory' &&
          entry.when?.includes('explorerResourceIsFolder == true'),
      ),
    );
  });

  it('has no panel toolbar commands now that follow, merges and reset live in the History modal', () => {
    for (const id of [
      'gitCheckout.pathHistory.toggleFollow',
      'gitCheckout.pathHistory.toggleMerges',
      'gitCheckout.pathHistory.resetFile',
    ]) {
      assert.equal(declared.has(id), false, id);
    }
    assert.equal(
      contributes.menus['editor/title'].some((entry) => entry.command?.startsWith('gitCheckout.pathHistory.')),
      false,
    );
  });
});
