import { DEFAULT_SUBJECT_LIMITS, type SubjectLengthLimits } from '../shared/changes/changesProtocol';
import type { GraphOrder } from '../shared/graph/graphProtocol';

const DEFAULT_NETWORK_TIMEOUT_MS = 300_000;
const DEFAULT_WATCH_DEBOUNCE_MS = 200;
const DEFAULT_AUTO_FETCH_SECONDS = 180;

export interface GitCheckoutSettingsReader {
  leanBranchingStashOnSwitch(): boolean;
  gitSkipHooks(): boolean;
  networkTimeoutMs(): number;
  watchDebounceMs(): number;
  autoFetchEnabled(): boolean;
  fetchIncludeTags(): boolean;
  commitPushAfterCommit(): boolean;
  commitSubjectLimits(): SubjectLengthLimits;
  checkoutUpdateSubmodules(): boolean;
  cloneDefaultFolder(): string;
  branchRememberCheckout(): boolean;
  autoFetchIntervalSeconds(): number;
  graphOrder(): GraphOrder;
  graphGravatar(): boolean;
  graphGitHubAvatars(): boolean;
  graphCompactBranchLabels(): boolean;
  graphShowReflog(): boolean;
  graphShowStashes(): boolean;
  graphShowRemoteBranches(): boolean;
  graphShowTags(): boolean;
  setGraphShowReflog(enabled: boolean): Promise<void>;
}

export const defaultGitCheckoutSettings: GitCheckoutSettingsReader = {
  leanBranchingStashOnSwitch: () => false,
  gitSkipHooks: () => false,
  networkTimeoutMs: () => DEFAULT_NETWORK_TIMEOUT_MS,
  watchDebounceMs: () => DEFAULT_WATCH_DEBOUNCE_MS,
  autoFetchEnabled: () => false,
  fetchIncludeTags: () => false,
  commitPushAfterCommit: () => false,
  commitSubjectLimits: () => ({ ...DEFAULT_SUBJECT_LIMITS }),
  checkoutUpdateSubmodules: () => true,
  cloneDefaultFolder: () => '',
  branchRememberCheckout: () => true,
  autoFetchIntervalSeconds: () => DEFAULT_AUTO_FETCH_SECONDS,
  graphOrder: () => 'date',
  graphGravatar: () => false,
  graphGitHubAvatars: () => false,
  graphCompactBranchLabels: () => true,
  graphShowReflog: () => false,
  graphShowStashes: () => true,
  graphShowRemoteBranches: () => true,
  graphShowTags: () => true,
  setGraphShowReflog: async () => {},
};

export function createWorkspaceGitCheckoutSettings(): GitCheckoutSettingsReader {
  // Loaded only in the extension host (not unit tests).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const vscode = require('vscode') as typeof import('vscode');
  const config = () => vscode.workspace.getConfiguration('gitCheckout');
  return {
    leanBranchingStashOnSwitch: () =>
      config().get<boolean>('leanBranching.stashOnSwitch', false),
    gitSkipHooks: () => config().get<boolean>('git.skipHooks', false),
    networkTimeoutMs: () =>
      config().get<number>('network.timeoutMs', DEFAULT_NETWORK_TIMEOUT_MS),
    watchDebounceMs: () =>
      config().get<number>('watch.debounceMs', DEFAULT_WATCH_DEBOUNCE_MS),
    autoFetchEnabled: () => config().get<boolean>('autoFetch.enabled', true),
    fetchIncludeTags: () => config().get<boolean>('fetch.includeTags', false),
    commitPushAfterCommit: () => config().get<boolean>('commit.pushAfterCommit', false),
    commitSubjectLimits: () => ({
      warning: config().get<number>('commit.subjectWarningLength', DEFAULT_SUBJECT_LIMITS.warning),
      limit: config().get<number>('commit.subjectLengthLimit', DEFAULT_SUBJECT_LIMITS.limit),
    }),
    checkoutUpdateSubmodules: () => config().get<boolean>('checkout.updateSubmodules', true),
    cloneDefaultFolder: () => config().get<string>('clone.defaultFolder', '').trim(),
    branchRememberCheckout: () => config().get<boolean>('branch.rememberCheckout', true),
    autoFetchIntervalSeconds: () =>
      config().get<number>('autoFetch.intervalSeconds', DEFAULT_AUTO_FETCH_SECONDS),
    graphOrder: () => (config().get<string>('graph.order', 'date') === 'topo' ? 'topo' : 'date'),
    graphGravatar: () => config().get<boolean>('graph.gravatar', false),
    graphGitHubAvatars: () => config().get<boolean>('graph.githubAvatars', true),
    graphCompactBranchLabels: () => config().get<boolean>('graph.compactBranchLabels', true),
    graphShowReflog: () => config().get<boolean>('graph.showReflog', false),
    graphShowStashes: () => config().get<boolean>('graph.showStashes', true),
    graphShowRemoteBranches: () => config().get<boolean>('graph.showRemoteBranches', true),
    graphShowTags: () => config().get<boolean>('graph.showTags', true),
    setGraphShowReflog: (enabled) =>
      Promise.resolve(
        config().update(
          'graph.showReflog',
          enabled,
          vscode.workspace.workspaceFolders?.length
            ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.Global,
        ),
      ),
  };
}
