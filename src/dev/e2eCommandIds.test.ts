import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { commandIdsInE2eSource } from './e2eCommandIds';

const repoRoot = join(__dirname, '..', '..');

describe('commandIdsInE2eSource', () => {
  it('collects quoted command ids and skips the panel view type', () => {
    const source = [
      "executeCommand('gitCheckout.sidebar.showInGraph', main);",
      "executeCommand('gitCheckout.sidebar.revealInGraph', main);",
      "viewType.endsWith('gitCheckout.main')",
    ].join('\n');
    assert.deepEqual(commandIdsInE2eSource(source), [
      'gitCheckout.sidebar.revealInGraph',
      'gitCheckout.sidebar.showInGraph',
    ]);
  });

  it('skips context keys and the focus command VS Code makes for every view', () => {
    const source = [
      "executeCommand('setContext', 'gitCheckout.panelOpen', true);",
      "executeCommand('gitCheckout.unstaged.focus');",
      "executeCommand('gitCheckout.changes.stage');",
    ].join('\n');
    assert.deepEqual(commandIdsInE2eSource(source), ['gitCheckout.changes.stage']);
  });

  it('matches every command id quoted by the e2e suite to package.json', () => {
    const e2eDir = join(repoRoot, 'e2e');
    const ids = readdirSync(e2eDir)
      .filter((name) => name.endsWith('.ts'))
      .flatMap((name) => commandIdsInE2eSource(readFileSync(join(e2eDir, name), 'utf8')));
    const unique = [...new Set(ids)].sort();
    assert.ok(unique.length > 0);
    const contributed = new Set(
      (
        JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
          contributes: { commands: { command: string }[] };
        }
      ).contributes.commands.map((command) => command.command),
    );
    const missing = unique.filter((id) => !contributed.has(id));
    assert.deepEqual(missing, []);
  });
});
