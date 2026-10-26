import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import * as l10n from '@vscode/l10n';
import { BUNDLE_PATH, extractL10nBundle } from './dev/exportL10n';
import { findUnlocalized } from './dev/findUnlocalized';

describe('l10n', () => {
  it('fills a placeholder when no bundle is loaded', () => {
    assert.equal(l10n.t('Added to .gitignore: {0}', 'dist/'), 'Added to .gitignore: dist/');
  });
});

describe('package.nls.json', () => {
  it('defines every %key% referenced by package.json', () => {
    const root = join(__dirname, '..');
    const manifest = readFileSync(join(root, 'package.json'), 'utf8');
    const messages = JSON.parse(readFileSync(join(root, 'package.nls.json'), 'utf8')) as Record<
      string,
      string
    >;
    const keys = [...manifest.matchAll(/%([^%\s]+)%/g)].map((match) => match[1] ?? '');
    const missing = [...new Set(keys)].filter((key) => !(key in messages));
    assert.deepEqual(missing, []);
  });
});

const root = join(__dirname, '..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  contributes: {
    commands: { command: string; title?: string; category?: string }[];
    viewsContainers: Record<string, { id: string; title: string }[]>;
    views: Record<string, { id: string; name: string }[]>;
    submenus?: { id: string; label: string }[];
  };
};

describe('contributed text', () => {
  it('is always a %key% from package.nls.json, never a literal', () => {
    const literals: string[] = [];
    const check = (where: string, value: string | undefined): void => {
      if (value !== undefined && !/^%[^%\s]+%$/.test(value)) {
        literals.push(`${where}: ${value}`);
      }
    };
    for (const command of manifest.contributes.commands) {
      check(`${command.command} title`, command.title);
      check(`${command.command} category`, command.category);
    }
    for (const containers of Object.values(manifest.contributes.viewsContainers)) {
      for (const container of containers) { check(`container ${container.id}`, container.title); }
    }
    for (const views of Object.values(manifest.contributes.views)) {
      for (const view of views) { check(`view ${view.id}`, view.name); }
    }
    for (const submenu of manifest.contributes.submenus ?? []) { check(`submenu ${submenu.id}`, submenu.label); }
    assert.deepEqual(literals, []);
  });

  it('has no package.nls.json entry that nothing uses', () => {
    const text = readFileSync(join(root, 'package.json'), 'utf8');
    const messages = JSON.parse(readFileSync(join(root, 'package.nls.json'), 'utf8')) as Record<string, string>;
    const unused = Object.keys(messages).filter((key) => !text.includes(`%${key}%`));
    assert.deepEqual(unused, []);
  });
});

describe('source strings', () => {
  it('are all in l10n/bundle.l10n.json; run `npm run l10n:export` after changing one', async () => {
    const saved = JSON.parse(readFileSync(join(root, BUNDLE_PATH), 'utf8')) as Record<string, string>;
    assert.deepEqual(saved, await extractL10nBundle());
  });

  it('are never written in code without going through l10n.t()', () => {
    // Text for developers and the language model, not for people using the extension.
    const internal = [
      /Invalid (hunk|line) id|Invalid working-copy path/,
      /Skipped malformed/,
      /Initializing git-flow does not use/,
      /Git watch verify/,
      /Write a git commit message|Staged changes:/,
      // Error codes and key names, which are compared in code and never shown.
      /: (Timeout|Cancelled|Lock|Home|End|Escape|Enter|Tab)$/,
    ];
    const unlocalized = findUnlocalized().filter((line) => !internal.some((pattern) => pattern.test(line)));
    assert.deepEqual(unlocalized, []);
  });
});

describe('command titles', () => {
  it('do not repeat the category the Command Palette already shows before them', () => {
    const nls = JSON.parse(readFileSync(join(root, 'package.nls.json'), 'utf8')) as Record<string, string>;
    const repeated = Object.entries(nls)
      .filter(([key]) => key.startsWith('command.') && key.endsWith('.title'))
      .filter(([key, title]) => {
        const category = nls[key.replace(/\.title$/, '.category')];
        return category !== undefined && title.startsWith(`${category}: `);
      })
      .map(([key]) => key);
    assert.deepEqual(repeated, []);
  });
});
