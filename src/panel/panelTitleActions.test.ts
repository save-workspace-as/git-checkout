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

const allTitleActions = contributes.menus['editor/title'];
/** The diff tab has its own options; every other tab action belongs to a Git Checkout window. */
const isDiffTab = (entry: MenuEntry): boolean => /activeWebviewPanelId == 'gitCheckout\.(diff|commitDiff|treePreview)'/.test(entry.when ?? '');
const optionsOf = (panel: string): string[] =>
  allTitleActions.filter((entry) => entry.when?.startsWith(`activeWebviewPanelId == '${panel}'`) && entry.command.startsWith('gitCheckout.diff.'))
    .map((entry) => entry.command.replace('gitCheckout.diff.', ''));
const titleActions = allTitleActions.filter((entry) => !isDiffTab(entry));
const commandById = new Map(contributes.commands.map((c) => [c.command, c]));

describe('panel title bar actions', () => {
  it('only show while a Git Checkout panel is active', () => {
    for (const entry of allTitleActions) {
      assert.match(
        entry.when ?? '',
        /activeWebviewPanelId == 'gitCheckout\.(main|pathHistory|blame|diff|commitDiff|treePreview)'/,
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
      'gitCheckout.undo',
      'gitCheckout.applyPatchFromClipboard',
    ]) {
      assert.equal(commandById.get(id)?.enablement, '!gitCheckout.repoOperationActive', id);
    }
  });

  it('keeps the buttons of every view title visible instead of only on hover', () => {
    assert.equal(contributes.configurationDefaults?.['workbench.view.alwaysShowHeaderActions'], true);
  });

  it('puts the diff options in the title bar of every diff tab, highlighted while on', () => {
    const shared = ['toggleIgnoreWhitespace', 'toggleInvisibles', 'toggleWrap', 'moreContext', 'lessContext', 'toggleFullFile', 'toggleSideBySide'];
    // A diff or a preview is a tab of the editor area: its options are in the tab's title bar.
    assert.deepEqual(optionsOf('gitCheckout.commitDiff'), ['swapSides', ...shared]);
    assert.deepEqual(optionsOf('gitCheckout.diff'), shared);
    assert.deepEqual(optionsOf('gitCheckout.treePreview'), ['toggleIgnoreWhitespace', 'toggleInvisibles', 'toggleWrap']);
    // The buttons that switch something on carry the state that highlights them.
    for (const id of ['toggleIgnoreWhitespace', 'toggleInvisibles', 'toggleWrap', 'toggleFullFile', 'toggleSideBySide']) {
      assert.ok(commandById.get(`gitCheckout.diff.${id}`)?.toggled, id);
    }
  });

  it('lists in the Command Palette only what the tab toolbar offers, and Open', () => {
    const palette = (contributes.menus as Record<string, { command: string; when?: string }[]>).commandPalette;
    const toolbar = new Set(titleActions.map((entry) => entry.command));
    // The diff tab's buttons are hidden from the palette, like the diff buttons of the other views.
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

  it('stages an unstaged file and unstages a staged one with Enter in the Changes list', () => {
    const enter = contributes.keybindings.find((binding) => binding.key === 'enter' && binding.when?.includes('focusedView == gitCheckout.changes'));
    assert.equal(enter?.command, 'gitCheckout.changes.toggle');
    // Typing in a box must not stage anything.
    assert.match(enter?.when ?? '', /!inputFocus/);
  });
});
