import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

interface MenuEntry {
  command: string;
  when?: string;
  group?: string;
}

const { contributes } = JSON.parse(
  readFileSync(join(__dirname, '../../package.json'), 'utf8'),
) as {
  contributes: {
    configurationDefaults?: Record<string, unknown>;
    keybindings: { command: string; key: string; when?: string }[];
    commands: { command: string; icon?: string; enablement?: string; toggled?: string }[];
    menus: Record<string, MenuEntry[]>;
  };
};

const titleActions = contributes.menus['editor/title'];
const commandById = new Map(contributes.commands.map((c) => [c.command, c]));

describe('panel title bar actions', () => {
  it('only show while a Git Checkout panel is active', () => {
    for (const entry of titleActions) {
      assert.match(
        entry.when ?? '',
        /activeWebviewPanelId == 'gitCheckout\.(main|pathHistory|blame)'/,
        entry.command,
      );
    }
  });

  it('puts sync, stash and branch inline with codicons, in order', () => {
    const inline = titleActions
      .filter((m) => m.group?.startsWith('navigation'))
      .map((m) => m.command);
    assert.deepEqual(inline, [
      'gitCheckout.fetch',
      'gitCheckout.pull',
      'gitCheckout.push',
      'gitCheckout.sidebar.createStash',
      'gitCheckout.sidebar.createBranch',
      'gitCheckout.bisect.good',
      'gitCheckout.bisect.bad',
      'gitCheckout.bisect.skip',
      'gitCheckout.bisect.reset',
      'gitCheckout.compare.copyPatch',
      'gitCheckout.compare.savePatch',
    ]);
    for (const id of [
      'gitCheckout.fetch',
      'gitCheckout.pull',
      'gitCheckout.push',
      'gitCheckout.sidebar.createStash',
      'gitCheckout.sidebar.createBranch',
      'gitCheckout.graph.collapseMerges',
      'gitCheckout.graph.showAllMerges',
      'gitCheckout.graph.showReflog',
      'gitCheckout.graph.hideReflog',
      'gitCheckout.bisect.good',
      'gitCheckout.bisect.bad',
      'gitCheckout.bisect.skip',
      'gitCheckout.bisect.reset',
    ]) {
      assert.match(commandById.get(id)?.icon ?? '', /^\$\([\w-]+\)$/, `${id} needs a codicon`);
    }
  });

  it('replaces the sync toolbar with bisect actions while a bisect is running', () => {
    const whenOf = (command: string) => titleActions.find((entry) => entry.command === command)?.when ?? '';
    for (const id of [
      'gitCheckout.fetch',
      'gitCheckout.pull',
      'gitCheckout.push',
      'gitCheckout.sidebar.createStash',
      'gitCheckout.sidebar.createBranch',
      'gitCheckout.graph.collapseMerges',
      'gitCheckout.graph.showAllMerges',
      'gitCheckout.graph.showReflog',
      'gitCheckout.graph.hideReflog',
    ]) {
      assert.match(whenOf(id), /!gitCheckout\.bisectActive/, id);
    }
    for (const id of [
      'gitCheckout.bisect.good',
      'gitCheckout.bisect.bad',
      'gitCheckout.bisect.skip',
      'gitCheckout.bisect.reset',
    ]) {
      assert.match(whenOf(id), /gitCheckout\.bisectActive/, id);
      assert.doesNotMatch(whenOf(id), /!gitCheckout\.bisectActive/, id);
    }
  });

  it('disables git operations while one is running', () => {
    for (const id of [
      'gitCheckout.fetch',
      'gitCheckout.pull',
      'gitCheckout.push',
      'gitCheckout.pushForceWithLease',
      'gitCheckout.commit',
    ]) {
      assert.equal(
        commandById.get(id)?.enablement,
        '!gitCheckout.syncBusy && !gitCheckout.repoOperationActive',
        id,
      );
    }
  });

  it('disables stash and branch toolbar actions while a repo operation is active', () => {
    for (const id of ['gitCheckout.sidebar.createStash', 'gitCheckout.sidebar.createBranch']) {
      assert.equal(commandById.get(id)?.enablement, '!gitCheckout.repoOperationActive', id);
    }
  });

  it('disables history-changing commands while a repo operation is active', () => {
    for (const id of [
      'gitCheckout.checkout',
      'gitCheckout.merge',
      'gitCheckout.rebase',
      'gitCheckout.interactiveRebase',
      'gitCheckout.reset',
      'gitCheckout.cherryPick',
      'gitCheckout.revert',
      'gitCheckout.applyPatch',
      'gitCheckout.createPatch',
      'gitCheckout.applyPatchFromClipboard',
    ]) {
      assert.equal(commandById.get(id)?.enablement, '!gitCheckout.repoOperationActive', id);
    }
  });

  it('keeps the buttons of every view title visible instead of only on hover', () => {
    assert.equal(contributes.configurationDefaults?.['workbench.view.alwaysShowHeaderActions'], true);
  });

  it('puts the diff options in the header of every diff view, highlighted while on', () => {
    const titles = (contributes.menus as Record<string, (MenuEntry & { when?: string })[]>)['view/title'];
    const commandsOf = (view: string): string[] =>
      titles.filter((entry) => (entry.when === `view == ${view}` || entry.when?.startsWith(`view == ${view} `)) && entry.command.startsWith('gitCheckout.diff.'))
        .map((entry) => entry.command.replace('gitCheckout.diff.', ''));
    const shared = ['toggleIgnoreWhitespace', 'toggleInvisibles', 'toggleWrap', 'moreContext', 'lessContext', 'toggleFullFile', 'toggleSideBySide'];
    assert.deepEqual(commandsOf('gitCheckout.commit'), ['swapSides', ...shared]);
    assert.deepEqual(commandsOf('gitCheckout.workingCopy'), shared);
    assert.deepEqual(commandsOf('gitCheckout.treePreview'), ['toggleIgnoreWhitespace', 'toggleInvisibles', 'toggleWrap']);
    // The buttons that switch something on carry the state that highlights them.
    for (const id of ['toggleIgnoreWhitespace', 'toggleInvisibles', 'toggleWrap', 'toggleFullFile', 'toggleSideBySide']) {
      assert.ok(commandById.get(`gitCheckout.diff.${id}`)?.toggled, id);
    }
  });

  it('lists in the Command Palette only what the tab toolbar offers, and Open', () => {
    const palette = (contributes.menus as Record<string, { command: string; when?: string }[]>).commandPalette;
    const toolbar = new Set(titleActions.map((entry) => entry.command));
    const shown = contributes.commands
      .map((command) => command.command)
      .filter((id) => !palette.some((entry) => entry.command === id && entry.when === 'false'));
    assert.deepEqual(
      [...shown].sort(),
      [...new Set([...toolbar, 'gitCheckout.open'])].sort(),
      'every other command must be hidden from the palette',
    );
    // A command that only makes sense in some state is listed only then, like its toolbar button.
    const when = (id: string) => palette.find((entry) => entry.command === id)?.when;
    assert.equal(when('gitCheckout.bisect.good'), 'gitCheckout.bisectActive');
    assert.equal(when('gitCheckout.compare.savePatch'), 'gitCheckout.branchCompareActive');
    assert.match(when('gitCheckout.graph.showAllMerges') ?? '', /^gitCheckout\.graph\.collapseMerges/);
    assert.equal(when('gitCheckout.fetch'), '!gitCheckout.bisectActive');
    assert.equal(when('gitCheckout.open'), undefined);
  });

  it('moves files between the Unstaged and Staged lists with Enter', () => {
    const enter = (view: string) =>
      contributes.keybindings.find((binding) => binding.key === 'enter' && binding.when?.includes(`focusedView == ${view}`));
    assert.equal(enter('gitCheckout.unstaged')?.command, 'gitCheckout.changes.stage');
    assert.equal(enter('gitCheckout.staged')?.command, 'gitCheckout.changes.unstage');
    // Typing in a box must not stage anything.
    assert.match(enter('gitCheckout.unstaged')?.when ?? '', /!inputFocus/);
  });
});
