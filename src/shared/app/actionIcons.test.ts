import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { ACTION_ICONS, type ActionIcon } from './actionIcons';

const manifest = JSON.parse(readFileSync(join(__dirname, '../../../package.json'), 'utf8')) as {
  contributes: { commands: { command: string; icon?: string }[] };
};

/** Every command that has an icon, and the action that icon stands for. */
const COMMAND_ACTIONS: Record<string, ActionIcon> = {
  'gitCheckout.diff.previousChange': 'previousChange',
  'gitCheckout.diff.nextChange': 'nextChange',
  'gitCheckout.diff.swapSides': 'swapSides',
  'gitCheckout.diff.fileTree': 'fileTree',
  'gitCheckout.diff.fileFlat': 'fileList',
  'gitCheckout.diff.toggleIgnoreWhitespace': 'ignoreWhitespace',
  'gitCheckout.diff.toggleInvisibles': 'showInvisibles',
  'gitCheckout.diff.moreContext': 'moreContext',
  'gitCheckout.diff.lessContext': 'lessContext',
  'gitCheckout.diff.toggleFullFile': 'fullFile',
  'gitCheckout.diff.toggleSideBySide': 'sideBySide',
  'gitCheckout.diff.toggleWrap': 'wrapLines',
  'gitCheckout.changes.stage': 'stage',
  'gitCheckout.changes.unstage': 'unstage',
  'gitCheckout.changes.open': 'openFile',
  'gitCheckout.file.open': 'openFile',
  'gitCheckout.file.openDiff': 'openDiff',
  'gitCheckout.changes.viewAs.tree': 'fileTree',
  'gitCheckout.changes.viewAs.list': 'fileList',
  'gitCheckout.changes.toggleHideUntracked': 'untrackedFiles',
  'gitCheckout.changes.toggleShowIgnored': 'ignoredFiles',
  'gitCheckout.changes.stageAll': 'stage',
  'gitCheckout.changes.unstageAll': 'unstage',
  'gitCheckout.graph.collapseMerges': 'collapseMerges',
  'gitCheckout.graph.showAllMerges': 'showAllMerges',
  'gitCheckout.graph.showReflog': 'reflog',
  'gitCheckout.graph.hideReflog': 'reflog',
  'gitCheckout.pathHistory.file': 'fileHistory',
  'gitCheckout.blame.file': 'blame',
  'gitCheckout.searchCommits': 'search',
  'gitCheckout.sidebar.search': 'search',
  'gitCheckout.sidebar.showSubmoduleDiff': 'openDiff',
};

describe('action icons', () => {
  it('gives each action its own icon, so two different actions never look alike', () => {
    const icons = Object.values(ACTION_ICONS);
    assert.equal(new Set(icons).size, icons.length);
  });

  it('uses the same icon for an action in every command that offers it', () => {
    const icons = new Map(manifest.contributes.commands.map((command) => [command.command, command.icon]));
    for (const [command, action] of Object.entries(COMMAND_ACTIONS)) {
      assert.equal(icons.get(command), `$(${ACTION_ICONS[action]})`, command);
    }
  });
});
