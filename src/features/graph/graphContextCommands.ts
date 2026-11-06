import type { GraphBranchChoice, GraphCommitContext } from '../../shared/graph/graphProtocol';
import type { WebviewMessage } from '../../shared/protocol';

export interface GraphContextCommand {
  selection: GraphCommitContext['graphSelection'];
  toMessage(context: GraphCommitContext): WebviewMessage;
}

/** Commands contributed to the graph's native `webview/context` menu. */
export const GRAPH_CONTEXT_COMMANDS: Record<string, GraphContextCommand> = {
  'gitCheckout.graph.checkout': {
    selection: 'single',
    toMessage: (c) => ({ type: 'historyCheckout', sha: c.sha }),
  },
  'gitCheckout.graph.checkoutRef': {
    selection: 'single',
    toMessage: (c) => ({
      type: 'historyCheckoutRef',
      ref: c.graphBranch ?? c.sha,
      local: c.graphBranchKind === 'local',
    }),
  },
  'gitCheckout.graph.mergeHere': {
    selection: 'single',
    toMessage: (c) => ({ type: 'historyMerge', ref: c.graphBranch ?? c.sha }),
  },
  'gitCheckout.graph.rebaseHere': {
    selection: 'single',
    toMessage: (c) => ({ type: 'historyRebaseOnto', ref: c.graphBranch ?? c.sha }),
  },
  'gitCheckout.graph.deleteBranch': {
    selection: 'single',
    toMessage: (c) => ({
      type: 'historyDeleteBranch',
      name: c.graphBranch ?? '',
      remote: c.graphBranchKind === 'remote',
    }),
  },
  'gitCheckout.graph.compareWithHead': {
    selection: 'single',
    toMessage: (c) => ({ type: 'historyCompare', sha: c.sha, mode: 'head' }),
  },
  'gitCheckout.graph.compareWithMergeBase': {
    selection: 'single',
    toMessage: (c) => ({ type: 'historyCompare', sha: c.sha, mode: 'mergeBase' }),
  },
  'gitCheckout.graph.compareWithUpstream': {
    selection: 'single',
    toMessage: (c) => ({ type: 'historyCompare', sha: c.sha, mode: 'upstream', ...(c.graphBranch ? { branch: c.graphBranch } : {}) }),
  },
  'gitCheckout.graph.compareWithRef': {
    selection: 'single',
    toMessage: (c) => ({ type: 'historyCompare', sha: c.sha, mode: 'ref' }),
  },
  'gitCheckout.graph.fixup': {
    selection: 'single',
    toMessage: (c) => ({ type: 'historyFixup', sha: c.sha }),
  },
  'gitCheckout.graph.squashIntoParent': {
    selection: 'single',
    toMessage: (c) => ({ type: 'historySquashIntoParent', sha: c.sha }),
  },
  'gitCheckout.graph.branch.hide': {
    selection: 'single',
    toMessage: (c) => ({ type: 'historyHideBranch', name: c.graphBranch ?? '', remote: c.graphBranchKind === 'remote' }),
  },
  'gitCheckout.graph.branch.fastForward': {
    selection: 'single',
    toMessage: (c) => ({ type: 'historyBranchAction', action: 'fastForward', ref: c.graphBranch ?? '' }),
  },
  'gitCheckout.graph.branch.pull': {
    selection: 'single',
    toMessage: (c) => ({ type: 'historyBranchAction', action: 'pull', ref: c.graphBranch ?? '' }),
  },
  'gitCheckout.graph.branch.push': {
    selection: 'single',
    toMessage: (c) => ({ type: 'historyBranchAction', action: 'push', ref: c.graphBranch ?? '' }),
  },
  'gitCheckout.graph.branch.pullRequest': {
    selection: 'single',
    toMessage: (c) => ({ type: 'historyBranchAction', action: 'pullRequest', ref: c.graphBranch ?? '' }),
  },
  'gitCheckout.graph.branch.pullRequestWithAi': {
    selection: 'single',
    toMessage: (c) => ({ type: 'historyBranchAction', action: 'pullRequestWithAi', ref: c.graphBranch ?? '' }),
  },
  'gitCheckout.graph.branch.rename': {
    selection: 'single',
    toMessage: (c) => ({ type: 'historyBranchAction', action: 'rename', ref: c.graphBranch ?? '' }),
  },
  'gitCheckout.graph.branch.copyName': {
    selection: 'single',
    toMessage: (c) => ({ type: 'historyBranchAction', action: 'copyName', ref: c.graphBranch ?? '' }),
  },
  'gitCheckout.graph.newBranch': {
    selection: 'single',
    toMessage: (c) => {
      // The right-clicked branch, else the commit's own name, else its hash.
      const startRef = c.graphBranch ?? c.graphStartRef;
      return { type: 'historyNewBranch', sha: c.sha, ...(startRef ? { startRef } : {}) };
    },
  },
  'gitCheckout.graph.newTag': {
    selection: 'single',
    toMessage: (c) => ({ type: 'historyNewTag', sha: c.sha }),
  },
  'gitCheckout.graph.editMessage': {
    selection: 'single',
    toMessage: (c) => ({ type: 'historyEditMessage', sha: c.sha }),
  },
  'gitCheckout.graph.cherryPick': {
    selection: 'single',
    toMessage: (c) => ({ type: 'historyCherryPick', sha: c.sha }),
  },
  'gitCheckout.graph.revert': {
    selection: 'single',
    toMessage: (c) => ({ type: 'historyRevert', sha: c.sha }),
  },
  'gitCheckout.graph.reset': {
    selection: 'single',
    toMessage: (c) => ({ type: 'historyReset', sha: c.sha }),
  },
  'gitCheckout.graph.interactiveRebase': {
    selection: 'single',
    toMessage: (c) => ({ type: 'historyInteractiveRebase', onto: c.sha }),
  },
  'gitCheckout.graph.copyHash': {
    selection: 'single',
    toMessage: (c) => ({ type: 'graphCopy', text: c.sha }),
  },
  'gitCheckout.graph.copySubject': {
    selection: 'single',
    toMessage: (c) => ({ type: 'graphCopy', text: c.subject }),
  },
  'gitCheckout.graph.cherryPickRange': {
    selection: 'multi',
    toMessage: (c) => ({ type: 'historyRange', op: 'cherryPick', shas: c.shas }),
  },
  'gitCheckout.graph.squash': {
    selection: 'multi',
    toMessage: (c) => ({ type: 'historyRange', op: 'squash', shas: c.shas }),
  },
  'gitCheckout.graph.drop': {
    selection: 'multi',
    toMessage: (c) => ({ type: 'historyRange', op: 'drop', shas: c.shas }),
  },
  'gitCheckout.graph.copyHashes': {
    selection: 'multi',
    toMessage: (c) => ({ type: 'graphCopy', text: c.shas.join('\n') }),
  },
  'gitCheckout.graph.copyPatch': {
    selection: 'single',
    toMessage: (c) => ({
      type: 'historyPatchExport',
      shas: [c.sha],
      op: 'copy',
      format: 'format-patch',
    }),
  },
  'gitCheckout.graph.explain': {
    selection: 'single',
    toMessage: (c) => ({ type: 'historyExplainCommit', sha: c.sha }),
  },
  'gitCheckout.graph.archive': {
    selection: 'single',
    toMessage: (c) => ({ type: 'historyArchive', ref: c.graphBranch ?? c.sha }),
  },
  'gitCheckout.graph.savePatch': {
    selection: 'single',
    toMessage: (c) => ({
      type: 'historyPatchExport',
      shas: [c.sha],
      op: 'save',
      format: 'format-patch',
    }),
  },
  'gitCheckout.graph.copyPatches': {
    selection: 'multi',
    toMessage: (c) => ({
      type: 'historyPatchExport',
      shas: c.shas,
      op: 'copy',
      format: 'format-patch',
    }),
  },
  'gitCheckout.graph.savePatches': {
    selection: 'multi',
    toMessage: (c) => ({
      type: 'historyPatchExport',
      shas: c.shas,
      op: 'save',
      format: 'format-patch',
    }),
  },
  'gitCheckout.graph.stashApply': {
    selection: 'single',
    toMessage: (c) => ({ type: 'stashApply', selector: c.stashSelector ?? '' }),
  },
  'gitCheckout.graph.stashPop': {
    selection: 'single',
    toMessage: (c) => ({ type: 'stashPop', selector: c.stashSelector ?? '' }),
  },
  'gitCheckout.graph.stashDrop': {
    selection: 'single',
    toMessage: (c) => ({ type: 'stashDrop', selector: c.stashSelector ?? '' }),
  },
};

/** The Branch submenu's commands, and which branches each can act on. */
const BRANCH_ACTIONS: Record<string, 'any' | 'local'> = {
  'gitCheckout.graph.checkoutRef': 'any',
  'gitCheckout.graph.deleteBranch': 'any',
  'gitCheckout.graph.branch.copyName': 'any',
  'gitCheckout.graph.branch.hide': 'any',
  'gitCheckout.graph.branch.fastForward': 'local',
  'gitCheckout.graph.branch.pull': 'local',
  'gitCheckout.graph.branch.push': 'local',
  'gitCheckout.graph.branch.pullRequest': 'local',
  'gitCheckout.graph.branch.pullRequestWithAi': 'local',
  'gitCheckout.graph.branch.rename': 'local',
};

/** The branches to ask about before running `id`: more than one, because a menu cannot name them. Empty when the action has one target. */
export function branchChoicesFor(id: string, context: GraphCommitContext): GraphBranchChoice[] {
  const scope = BRANCH_ACTIONS[id];
  const choices = scope === 'local' ? (context.graphBranchChoices ?? []).filter((c) => c.kind === 'local') : (context.graphBranchChoices ?? []);
  return scope && choices.length > 1 ? choices : [];
}

/** `context` aimed at one of the commit's branches. */
export const withBranch = (context: GraphCommitContext, choice: GraphBranchChoice): GraphCommitContext => ({
  ...context,
  graphBranch: choice.name,
  graphBranchKind: choice.kind,
  graphBranchChoices: [],
});
