import * as l10n from '@vscode/l10n';
import { revealLabel } from '../shared/app/platformCommands';
import type { CustomCommandDefinition } from './customCommands';

/** What a command needs besides running: a branch or tag to act on, or the repository folder. */
export type QuickLaunchTarget = 'localBranch' | 'tag' | 'repoUri';

export interface QuickLaunchItem {
  label: string;
  description?: string;
  command?: string;
  target?: QuickLaunchTarget;
  customCommand?: CustomCommandDefinition;
}

/** Repository actions only, sorted by label, and named like the commands they run. */
const builtinItems = (remote: boolean): readonly QuickLaunchItem[] => [
  { label: l10n.t('Apply Patch…'), command: 'gitCheckout.applyPatchFromClipboard' },
  { label: l10n.t('Bisect…'), command: 'gitCheckout.bisect.start' },
  { label: l10n.t('Blame…'), command: 'gitCheckout.blame.file' },
  { label: l10n.t('Checkout Branch…'), command: 'gitCheckout.checkout' },
  { label: l10n.t('Clean Untracked Files…'), command: 'gitCheckout.cleanUntracked' },
  { label: l10n.t('Clone…'), command: 'gitCheckout.clone' },
  { label: l10n.t('Delete Branch…'), command: 'gitCheckout.sidebar.deleteBranch', target: 'localBranch' },
  { label: l10n.t('Delete Merged Branches…'), command: 'gitCheckout.deleteMergedBranches' },
  { label: l10n.t('Delete Tag'), command: 'gitCheckout.sidebar.deleteTag', target: 'tag' },
  { label: l10n.t('Fast-Forward'), command: 'gitCheckout.sidebar.fastForward', target: 'localBranch' },
  { label: l10n.t('Fetch…'), command: 'gitCheckout.fetch' },
  { label: l10n.t('File History…'), command: 'gitCheckout.pathHistory.file' },
  { label: l10n.t('Filter by Active Branch'), command: 'gitCheckout.graph.toggleActiveBranchOnly' },
  { label: l10n.t('Git Flow…'), command: 'gitCheckout.gitFlow' },
  { label: l10n.t('Keyboard Shortcuts'), command: 'gitCheckout.openKeyboardShortcuts' },
  { label: l10n.t('Merge…'), command: 'gitCheckout.merge' },
  { label: l10n.t('New Branch…'), command: 'gitCheckout.sidebar.createBranch' },
  { label: l10n.t('New Tag…'), command: 'gitCheckout.sidebar.createTag' },
  { label: l10n.t('New Worktree…'), command: 'gitCheckout.sidebar.createWorktree' },
  { label: l10n.t('Open Pull Request on GitHub…'), command: 'gitCheckout.sidebar.openPullRequest', target: 'localBranch' },
  { label: l10n.t('Prune Remote Branches…'), command: 'gitCheckout.pruneRemote' },
  { label: l10n.t('Pull…'), command: 'gitCheckout.pull' },
  { label: l10n.t('Push…'), command: 'gitCheckout.push' },
  { label: l10n.t('Quick Fetch'), command: 'gitCheckout.quickFetch' },
  { label: l10n.t('Quick Pull'), command: 'gitCheckout.quickPull' },
  { label: l10n.t('Quick Push'), command: 'gitCheckout.quickPush' },
  { label: l10n.t('Quick Stash'), command: 'gitCheckout.quickStash' },
  { label: l10n.t('Rebase Current Branch onto…'), command: 'gitCheckout.rebase' },
  { label: l10n.t('Refresh'), command: 'gitCheckout.refresh' },
  { label: l10n.t('Rename Branch…'), command: 'gitCheckout.sidebar.renameBranch', target: 'localBranch' },
  { label: l10n.t('Repository Settings…'), command: 'gitCheckout.repoSettings' },
  { label: l10n.t('Repository Statistics…'), command: 'gitCheckout.statistics' },
  { label: l10n.t('Reveal HEAD'), command: 'gitCheckout.graph.revealHead' },
  { label: revealLabel(process.platform, remote), command: 'revealFileInOS', target: 'repoUri' },
  { label: l10n.t('Run Garbage Collection'), command: 'gitCheckout.gc' },
  { label: l10n.t('Save Stash…'), command: 'gitCheckout.sidebar.createStash' },
  { label: l10n.t('Sparse Checkout…'), command: 'gitCheckout.sparseCheckout' },
];

export function buildQuickLaunchItems(
  customCommands: readonly CustomCommandDefinition[],
  /** True in a remote window, where this machine is not the one showing the window. */
  remote = false,
): QuickLaunchItem[] {
  const custom = customCommands.map((command) => ({
    label: command.name,
    description: l10n.t('Custom {0} command', command.context),
    customCommand: command,
  }));
  // The reveal action is worded per system, so its place in the list depends on the system; sorting here keeps the order right everywhere.
  const builtin = [...builtinItems(remote)].sort((a, b) => a.label.localeCompare(b.label));
  return [...builtin, ...custom];
}
