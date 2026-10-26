import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  applyRepositoryMenu,
  REPOSITORY_ACTIONS,
  repositoryActionCommand,
  repositoryMenuId,
} from './repositoryMenuModel';
import { SIDEBAR_REPO_SLOTS, sidebarViewId } from './sidebarTreeModel';

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

  it('gives every repository view its own dropdown, shown only in that view', () => {
    const titleMenus = manifest.contributes.menus['view/title'];
    for (let slot = 0; slot < SIDEBAR_REPO_SLOTS; slot += 1) {
      const entry = titleMenus.find((item) => item.submenu === repositoryMenuId(slot));
      assert.equal(entry?.when, `view == ${sidebarViewId(slot)}`, `slot ${slot}`);
      assert.ok(manifest.contributes.submenus?.some((item) => item.id === repositoryMenuId(slot)));
      const items = manifest.contributes.menus[repositoryMenuId(slot)];
      assert.deepEqual(
        items.map((item) => item.command),
        REPOSITORY_ACTIONS.map((action) => repositoryActionCommand(slot, action.id)),
      );
    }
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
    for (let slot = 0; slot < SIDEBAR_REPO_SLOTS; slot += 1) {
      for (const action of REPOSITORY_ACTIONS) {
        assert.ok(hidden.has(repositoryActionCommand(slot, action.id)), `${slot}.${action.id}`);
      }
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
