import type { GraphCommitContext } from '../../shared/graph/graphProtocol';
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
