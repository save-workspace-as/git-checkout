import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const webview = join(__dirname, '../../webview');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : [];
  });
}

const created = new Set(
  sources(webview).flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(/createElement\('(vscode-[a-z-]+)'\)|<(vscode-[a-z-]+)[\s>]/g)]
      .map((match) => match[1] ?? match[2]),
  ),
);

describe('webview templates and the content security policy', () => {
  it('set styles through styleMap, because the page policy blocks inline style attributes', () => {
    const offenders = sources(webview)
      .filter((file) => !file.endsWith('.test.ts'))
      .flatMap((file) => readFileSync(file, 'utf8').split('\n').map((line, index) => ({ file, line, number: index + 1 })))
      .filter(({ line }) => /\sstyle="|\sstyle=\$\{(?!styleMap\()/.test(line))
      .map(({ file, number }) => `${file.slice(webview.length + 1)}:${number}`);
    assert.deepEqual(offenders, []);
  });
});

describe('VS Code Elements in the webviews', () => {
  it('uses at least the elements the forms need', () => {
    for (const tag of ['vscode-button', 'vscode-checkbox', 'vscode-textfield', 'vscode-textarea', 'vscode-single-select']) {
      assert.ok(created.has(tag), tag);
    }
  });

  it('registers every element a webview creates', () => {
    const registered = readFileSync(join(webview, 'elements.ts'), 'utf8');
    for (const tag of created) {
      assert.ok(registered.includes(`dist/${tag}/index.js`), `${tag} is not registered in webview/elements.ts`);
    }
  });

  it('lets the modal focus trap reach every element that takes focus', () => {
    const shell = readFileSync(join(webview, 'modalShell.ts'), 'utf8');
    // A button's host has a tabindex, and the layout elements and the progress bar take no input.
    const unfocusable = new Set([
      'vscode-button', 'vscode-button-group', 'vscode-checkbox-group', 'vscode-form-container', 'vscode-form-group', 'vscode-form-helper',
      'vscode-icon', 'vscode-label', 'vscode-option', 'vscode-progress-bar', 'vscode-radio-group', 'vscode-tab-panel', 'vscode-tabs', 'vscode-toolbar-container',
    ]);
    for (const tag of [...created].filter((name) => !unfocusable.has(name))) {
      assert.ok(shell.includes(`'${tag}`), `${tag} is missing from the focusable selector in webview/modalShell.ts`);
    }
  });

  it('gives every page that shows elements the codicon stylesheet their icons load', () => {
    for (const file of ['panel/gitCheckoutPanelManager.ts', 'panel/bottomPanelViews.ts']) {
      assert.match(readFileSync(join(__dirname, '..', file), 'utf8'), /id="vscode-codicon-stylesheet"/, file);
    }
  });

  it('imports the registration module from every webview entry that creates elements', () => {
    for (const entry of ['main', 'changesMain', 'commitMain', 'commitFilesMain', 'treeMain']) {
      assert.match(readFileSync(join(webview, `${entry}.ts`), 'utf8'), /import '\.\/elements';/, entry);
    }
  });
});
