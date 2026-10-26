import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as {
  extensionKind?: string[];
  extensionDependencies?: string[];
  contributes?: {
    commands?: { command: string }[];
    keybindings?: { command: string; key: string; mac?: string; when?: string }[];
    views?: Record<string, { id: string; icon?: string; contextualTitle?: string }[]>;
    configuration?: { properties?: Record<string, { tags?: string[] }> };
  };
  capabilities?: Record<string, { supported?: boolean | string; description?: string }>;
};

describe('where the extension can run', () => {
  it('runs next to the files and vscode.git, so a remote window uses the Git of the remote machine', () => {
    assert.deepEqual(manifest.extensionKind, ['workspace']);
  });

  it('declines virtual workspaces, which have no files on disk for the Git command line', () => {
    assert.equal(manifest.capabilities?.virtualWorkspaces?.supported, false);
    assert.match(manifest.capabilities?.virtualWorkspaces?.description ?? '', /^%.+%$/);
  });

  it('declines untrusted workspaces, as vscode.git does, since Git runs repository hooks', () => {
    assert.equal(manifest.capabilities?.untrustedWorkspaces?.supported, false);
    assert.match(manifest.capabilities?.untrustedWorkspaces?.description ?? '', /^%.+%$/);
  });
});

describe('guidelines for views and settings', () => {
  it('gives every view an icon and a contextual title, for when the user drags it out of its container', () => {
    const views = Object.values(manifest.contributes?.views ?? {}).flat();
    assert.ok(views.length > 0);
    assert.deepEqual(views.filter((view) => !view.icon || !view.contextualTitle).map((view) => view.id), []);
  });

  it('tags the setting that contacts an online service', () => {
    assert.deepEqual(manifest.contributes?.configuration?.properties?.['gitCheckout.graph.gravatar']?.tags, ['usesOnlineServices']);
  });
});

describe('keyboard shortcuts', () => {
  const bindings = manifest.contributes?.keybindings ?? [];
  const declared = new Set((manifest.contributes?.commands ?? []).map((entry) => entry.command));

  it('runs only commands that the extension declares, or the built-in Git extension provides', () => {
    const unknown = bindings.filter((entry) => !declared.has(entry.command) && !entry.command.startsWith('git.'));
    assert.deepEqual([...new Set(unknown.map((entry) => entry.command))], []);
  });

  it('applies only while a Git Checkout window or list has focus, never everywhere', () => {
    const everywhere = bindings.filter((entry) => !/gitCheckout|activeWebviewPanelId == 'gitCheckout\.main'/.test(entry.when ?? ''));
    assert.deepEqual(everywhere.map((entry) => `${entry.key} ${entry.command}`), []);
  });

  it('lets one setting turn every shortcut off, so VS Code keeps its own keys', () => {
    const always = bindings.filter((entry) => !/\) && config\.gitCheckout\.shortcuts\.enabled$/.test(entry.when ?? ''));
    assert.deepEqual(always.map((entry) => `${entry.key} ${entry.command}`), []);
  });

  it('gives every Ctrl shortcut a Command counterpart on macOS', () => {
    const missing = bindings.filter((entry) => /(^|\+)ctrl\+/.test(entry.key) && !entry.mac && !/^ctrl\+(alt\+)?shift\+alt/.test(entry.key));
    assert.deepEqual(missing.map((entry) => `${entry.key} ${entry.command}`), []);
  });

  it('does not give one key two meanings in the same place', () => {
    for (const platform of ['key', 'mac'] as const) {
      const seen = new Map<string, string>();
      const clashes: string[] = [];
      for (const entry of bindings) {
        const key = entry[platform] ?? (platform === 'mac' ? entry.key : entry.key);
        const id = `${key.split('+').sort().join('+')} when ${entry.when}`;
        const other = seen.get(id);
        if (other && other !== entry.command) { clashes.push(`${key}: ${other} and ${entry.command}`); }
        seen.set(id, entry.command);
      }
      assert.deepEqual(clashes, [], platform);
    }
  });

  /** Shortcuts for the actions this window has: [command, Windows and Linux key, macOS key]. */
  const WINDOW_SHORTCUTS: readonly [string, string, string][] = [
    ['gitCheckout.sidebar.showLocalChanges', 'ctrl+1', 'cmd+1'],
    ['gitCheckout.changes.focusCommit', 'ctrl+1', 'cmd+1'],
    ['gitCheckout.sidebar.showAllCommits', 'ctrl+2', 'cmd+2'],
    ['gitCheckout.graph.revealHead', 'ctrl+0', 'cmd+0'],
    ['gitCheckout.quickLaunch', 'ctrl+p', 'cmd+p'],
    ['gitCheckout.searchCommits', 'ctrl+f', 'cmd+f'],
    ['gitCheckout.searchNext', 'f3', 'f3'],
    ['gitCheckout.searchPrevious', 'shift+f3', 'shift+f3'],
    ['gitCheckout.graph.copy', 'ctrl+c', 'cmd+c'],
    ['gitCheckout.graph.remove', 'delete', 'backspace'],
    ['gitCheckout.graph.toggleActiveBranchOnly', 'ctrl+shift+a', 'cmd+shift+a'],
    ['gitCheckout.changes.commit', 'ctrl+enter', 'cmd+enter'],
    ['gitCheckout.changes.commitAndPush', 'ctrl+shift+enter', 'cmd+shift+enter'],
    ['gitCheckout.changes.stage', 'ctrl+shift+s', 'cmd+s'],
    ['gitCheckout.changes.unstage', 'ctrl+shift+s', 'cmd+s'],
    ['gitCheckout.changes.stageAll', 'ctrl+alt+shift+s', 'cmd+alt+shift+s'],
    ['gitCheckout.changes.discard', 'ctrl+shift+d', 'cmd+shift+d'],
    ['gitCheckout.changes.open', 'ctrl+o', 'cmd+alt+shift+o'],
    ['gitCheckout.changes.externalDiff', 'ctrl+d', 'cmd+d'],
    ['gitCheckout.changes.copyPath', 'ctrl+c', 'cmd+c'],
    ['gitCheckout.refresh', 'f5', 'cmd+r'],
    ['git.init', 'ctrl+shift+n', 'ctrl+shift+n'],
    ['gitCheckout.clone', 'ctrl+n', 'cmd+shift+n'],
    ['git.openRepository', 'ctrl+o', 'cmd+o'],
    ['gitCheckout.checkout', 'ctrl+b', 'cmd+b'],
    ['gitCheckout.fetch', 'ctrl+shift+f', 'cmd+shift+f'],
    ['gitCheckout.quickFetch', 'ctrl+alt+shift+f', 'cmd+alt+shift+f'],
    ['gitCheckout.pull', 'ctrl+shift+l', 'cmd+shift+l'],
    ['gitCheckout.quickPull', 'ctrl+alt+shift+l', 'cmd+alt+shift+l'],
    ['gitCheckout.push', 'ctrl+shift+p', 'cmd+shift+p'],
    ['gitCheckout.quickPush', 'ctrl+alt+shift+p', 'cmd+alt+shift+p'],
    ['gitCheckout.sidebar.createBranch', 'ctrl+shift+b', 'cmd+shift+b'],
    ['gitCheckout.sidebar.createTag', 'ctrl+shift+t', 'cmd+shift+t'],
    ['gitCheckout.sidebar.createStash', 'ctrl+shift+h', 'cmd+shift+h'],
    ['gitCheckout.quickStash', 'ctrl+alt+shift+h', 'cmd+alt+shift+h'],
    ['gitCheckout.revealRepository', 'ctrl+alt+o', 'cmd+ctrl+o'],
    ['gitCheckout.openRepoTerminal', 'ctrl+alt+t', 'cmd+ctrl+t'],
  ];

  it('keeps the window shortcuts for every action', () => {
    const missing = WINDOW_SHORTCUTS.filter(
      ([command, key, mac]) => !bindings.some((entry) => entry.command === command && entry.key === key && (entry.mac ?? entry.key) === mac),
    );
    assert.deepEqual(missing.map(([command, key]) => `${key} ${command}`), []);
  });

  it('scopes the shortcuts that need a row or a field to the list or view that has it', () => {
    const list = ['gitCheckout.changes.discard', 'gitCheckout.changes.open', 'gitCheckout.changes.externalDiff', 'gitCheckout.changes.copyPath'];
    const unscoped = bindings.filter((entry) => list.includes(entry.command) && !/focusedView == gitCheckout\.(unstaged|staged)/.test(entry.when ?? ''));
    assert.deepEqual(unscoped.map((entry) => `${entry.key} ${entry.command}`), []);
  });
});
