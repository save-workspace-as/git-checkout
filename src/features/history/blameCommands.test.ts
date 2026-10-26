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

describe('blame commands', () => {
  it('opens blame from the explorer and editor, not the file lists', () => {
    assert.ok(declared.has('gitCheckout.blame.file'));

    const explorer = contributes.menus['explorer/context'];
    assert.ok(
      explorer.some(
        (entry) =>
          entry.command === 'gitCheckout.blame.file' &&
          entry.when?.includes('explorerResourceIsFolder == false'),
      ),
    );
    assert.ok(
      contributes.menus['editor/context'].some((entry) => entry.command === 'gitCheckout.blame.file'),
    );

    const webview = contributes.menus['webview/context'];
    assert.equal(webview.some((entry) => entry.command === 'gitCheckout.file.blame'), false);
  });
});
