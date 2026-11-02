import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  applyRepositoryMenu,
  REPOSITORY_ACTIONS,
  repositoryActionCommand,
} from './repositoryMenuModel';
import { REPOSITORIES_VIEW_ID, SIDEBAR_VIEW_ID } from './sidebarTreeModel';

type Manifest = Parameters<typeof applyRepositoryMenu>[0];

const root = join(__dirname, '../..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Manifest;
const strings = JSON.parse(readFileSync(join(root, 'package.nls.json'), 'utf8')) as Record<string, string>;
const commands = new Map(manifest.contributes.commands.map((entry) => [entry.command, entry]));

describe('repository menu', () => {
  it('is up to date in package.json (run npm run sync:repo-menu after editing the actions)', () => {
    assert.deepEqual(applyRepositoryMenu(structuredClone(manifest)), manifest);
  });

  it('is idempotent', () => {
    const once = applyRepositoryMenu(structuredClone(manifest));
    assert.deepEqual(applyRepositoryMenu(structuredClone(once)), once);
  });

  it('offers the same actions on a right-click of a repository and in the menu of the Repository view', () => {
    const wanted = REPOSITORY_ACTIONS.map((action) => repositoryActionCommand(action.id));
    const commandsOn = (menu: 'view/item/context' | 'view/title', view: string): string[] =>
      manifest.contributes.menus[menu].filter((entry) => new RegExp(`^view == ${view.replaceAll('.', '\\.')}( |$)`).test(String(entry.when ?? ''))).map((entry) => String(entry.command));
    assert.deepEqual(commandsOn('view/item/context', REPOSITORIES_VIEW_ID), wanted);
    assert.deepEqual(commandsOn('view/title', SIDEBAR_VIEW_ID).filter((id) => id.startsWith('gitCheckout.repo.')), wanted);
    // Only a repository's row has the menu.
    for (const entry of manifest.contributes.menus['view/item/context'].filter((item) => String(item.command ?? '').startsWith('gitCheckout.repo.'))) {
      assert.match(String(entry.when ?? ''), /viewItem == repository/);
    }
  });

  it('has no menu or command left from when each repository had its own view', () => {
    const menus = [...Object.keys(manifest.contributes.menus), ...(manifest.contributes.submenus ?? []).map((item) => item.id)];
    assert.deepEqual(menus.filter((id) => /^gitCheckout\.repoMenu\./.test(id)), []);
    assert.deepEqual([...commands.keys()].filter((id) => /^gitCheckout\.repo\.\d/.test(id)), []);
  });

  it('only offers actions backed by a declared command, with a title and the same enablement', () => {
    const ids = new Set<string>();
    for (const action of REPOSITORY_ACTIONS) {
      assert.equal(ids.has(action.id), false, `duplicate ${action.id}`);
      ids.add(action.id);
      assert.ok(strings[`command.gitCheckout.repo.${action.id}.title`], `${action.id} has no title`);
      if (action.command === 'revealFileInOS') {
        continue; // built-in VS Code command
      }
      const base = commands.get(action.command);
      assert.ok(base, `${action.command} is not declared`);
      assert.equal(action.enablement, base.enablement, `${action.id} enablement`);
    }
  });

  it('hides every per-repository command from the command palette', () => {
    const hidden = new Set(
      manifest.contributes.menus.commandPalette.filter((item) => item.when === 'false').map((item) => item.command),
    );
    for (const action of REPOSITORY_ACTIONS) {
      assert.ok(hidden.has(repositoryActionCommand(action.id)), action.id);
    }
  });

  it('offers Repository Settings, and leaves out Git LFS and the features this extension does not have', () => {
    const titles = REPOSITORY_ACTIONS.map((action) => strings[`command.gitCheckout.repo.${action.id}.title`]);
    assert.ok(titles.includes('Repository Settings…'));
    for (const missing of [/lfs/i, /treemap/i, /statistics/i, /benchmark/i]) {
      assert.deepEqual(titles.filter((title) => missing.test(title)), []);
    }
  });
});
