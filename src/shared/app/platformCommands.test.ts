import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { REVEAL_COMMAND_BASES, platformCommandIds, revealLabel } from './platformCommands';

interface Entry { command?: string; when?: string; group?: string }
const root = join(__dirname, '../../..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  contributes: { commands: { command: string; title: string }[]; menus: Record<string, Entry[]> };
};
const nls = JSON.parse(readFileSync(join(root, 'package.nls.json'), 'utf8')) as Record<string, string>;
const titleOf = (id: string): string => {
  const command = manifest.contributes.commands.find((entry) => entry.command === id);
  assert.ok(command, `${id} is not declared`);
  return nls[command.title.replace(/%/g, '')];
};

describe('platform wording of reveal commands', () => {
  it('names the action the way each system does', () => {
    assert.equal(revealLabel('darwin'), 'Reveal in Finder');
    assert.equal(revealLabel('win32'), 'Reveal in File Explorer');
    assert.equal(revealLabel('linux'), 'Open Containing Folder');
    assert.equal(revealLabel('freebsd'), 'Open Containing Folder');
  });

  it('is neutral in a remote window, whose extension host runs on another system than the window', () => {
    for (const platform of ['darwin', 'win32', 'linux']) {
      assert.equal(revealLabel(platform, true), 'Reveal in File Manager');
    }
  });

  it('declares each reveal command once per system, titled for that system', () => {
    for (const base of REVEAL_COMMAND_BASES) {
      const [mac, windows, linux] = platformCommandIds(base);
      assert.equal(titleOf(mac), 'Reveal in Finder', mac);
      assert.equal(titleOf(windows), 'Reveal in File Explorer', windows);
      assert.equal(titleOf(linux), 'Open Containing Folder', linux);
    }
  });

  it('offers only the command for the current system wherever the base command is offered', () => {
    const menus = Object.entries(manifest.contributes.menus).filter(([key]) => key !== 'commandPalette');
    for (const base of REVEAL_COMMAND_BASES) {
      const [mac, windows, linux] = platformCommandIds(base);
      for (const [key, entries] of menus) {
        const offered = entries.filter((entry) => entry.command && platformCommandIds(base).includes(entry.command));
        if (offered.length === 0) { continue; }
        assert.deepEqual(offered.map((entry) => entry.command), [mac, windows, linux], `${key}: ${base}`);
        assert.deepEqual(
          offered.map((entry) => entry.when?.split(' && ').pop()),
          ['isMac', 'isWindows', 'isLinux'],
          `${key}: ${base}`,
        );
      }
    }
  });

  it('keeps the system-specific commands out of the Command Palette', () => {
    const hidden = new Set(
      manifest.contributes.menus.commandPalette.filter((entry) => entry.when === 'false').map((entry) => entry.command),
    );
    for (const base of REVEAL_COMMAND_BASES) {
      for (const id of platformCommandIds(base)) {
        assert.ok(hidden.has(id), id);
      }
    }
  });

  it('never calls the action "File Manager", which no system does', () => {
    assert.deepEqual(Object.entries(nls).filter(([, value]) => /File Manager/.test(value)), []);
  });
});
