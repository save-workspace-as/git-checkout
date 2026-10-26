import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { revealLabel } from '../shared/app/platformCommands';
import { buildQuickLaunchItems } from './quickLaunchItems';

describe('buildQuickLaunchItems', () => {
  it('lists built-in commands when no custom commands are configured', () => {
    const items = buildQuickLaunchItems([]);
    assert.ok(items.some((item) => item.command === 'gitCheckout.fetch'));
    assert.ok(items.every((item) => item.customCommand === undefined));
  });

  it('lists only repository actions, sorted by label', () => {
    const labels = buildQuickLaunchItems([]).map((item) => item.label);
    assert.deepEqual(labels, [...labels].sort((a, b) => a.localeCompare(b)));
    for (const label of ['Apply Patch…', 'Bisect…', 'New Worktree…', 'Git Flow…', 'Save Stash…']) {
      assert.ok(labels.includes(label), label);
    }
    for (const label of ['Show output', 'Verify watch', 'Open Git Checkout', 'Toggle GPG signing…']) {
      assert.ok(!labels.includes(label), label);
    }
  });

  it('asks for a ref only where the command needs one', () => {
    const targets = Object.fromEntries(buildQuickLaunchItems([]).map((item) => [item.label, item.target]));
    assert.equal(targets['Delete Branch…'], 'localBranch');
    assert.equal(targets['Delete Tag'], 'tag');
    assert.equal(targets[revealLabel()], 'repoUri');
    assert.equal(targets['Fetch…'], undefined);
  });

  it('appends custom commands for Quick Launch', () => {
    const items = buildQuickLaunchItems([
      { name: 'Open PR', command: 'https://example.com/${branch}', context: 'url' },
    ]);
    const custom = items.find((item) => item.label === 'Open PR');
    assert.ok(custom);
    assert.equal(custom?.description, 'Custom url command');
    assert.equal(custom?.customCommand?.context, 'url');
    assert.ok(items.findIndex((item) => item.command === 'gitCheckout.open') < items.length - 1);
  });

  it('words Reveal neutrally in a remote window', () => {
    const labels = buildQuickLaunchItems([], true).map((item) => item.label);
    assert.ok(labels.includes('Reveal in File Manager'));
    assert.ok(!labels.includes(revealLabel()));
  });

  it('opens from Cmd+P / Ctrl+P while the Git Checkout panel is focused', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
      contributes: { keybindings: { command: string; key: string; mac?: string; when?: string }[] };
    };
    const binding = manifest.contributes.keybindings.find(
      (entry) => entry.command === 'gitCheckout.quickLaunch' && entry.key === 'ctrl+p',
    );
    assert.equal(binding?.mac, 'cmd+p');
    assert.match(binding?.when ?? '', /activeWebviewPanelId == 'gitCheckout\.main'/);
  });
});
