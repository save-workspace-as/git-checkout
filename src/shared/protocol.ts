import type { DailyGitWebviewMessage, WorktreeStatusDto } from './changes/dailyGitProtocol';
import type { GraphHostMessage, GraphWebviewMessage } from './graph/graphProtocol';
import type { HistoryWebviewMessage, RepoOperationDto } from './history/historyProtocol';
import type { RefsHostMessage } from './branches/refsProtocol';
import type { SyncStatusDto, SyncWebviewMessage } from './sync/syncProtocol';
import type { CommitTreeHostMessage, CommitTreeWebviewMessage } from './history/commitTreeProtocol';
import type { ChangesHostMessage, ChangesWebviewMessage } from './changes/changesProtocol';
import type { DiffViewOption, PathHistoryHostMessage, PathHistoryWebviewMessage } from './history/pathHistoryProtocol';
import type { CommitDetailsHostMessage, CommitDetailsWebviewMessage } from './history/commitDetailsProtocol';
import type { StashWebviewMessage } from './stash/stashProtocol';
import type { WorkingCopyHostMessage, WorkingCopyWebviewMessage } from './changes/workingCopyProtocol';
import type { PatchWebviewMessage } from './patches/patchProtocol';
import type { RebaseHostMessage, RebaseWebviewMessage } from './rebase/rebaseProtocol';
import type { MergeHostMessage, MergeWebviewMessage } from './conflicts/mergeProtocol';
import type { OperationFormModalHostMessage, OperationFormModalWebviewMessage } from './forms/operationForm';

export type { RepoOperationDto, SyncStatusDto, WorktreeStatusDto };

export type GitBindingState =
  | 'ready'
  | 'git_extension_missing'
  | 'git_disabled'
  | 'api_unavailable';

export type EmptyReason =
  | 'noWorkspace'
  | 'gitDisabled'
  | 'gitMissing'
  | 'apiUnavailable'
  | 'noRepository';

export type PaneLayout = 'vertical' | 'horizontal';

export interface UiRepository {
  rootPath: string;
  headName: string | null;
}

export interface UiState {
  empty: boolean;
  emptyReason?: EmptyReason;
  bindingState: GitBindingState;
  repositories: UiRepository[];
  activeRepoRoot: string | null;
  headShort: string | null;
  layout: PaneLayout;
  sync: SyncStatusDto;
  worktree: WorktreeStatusDto;
  operation: RepoOperationDto;
}

export type HostMessage =
  | { type: 'bootstrap'; state: UiState }
  | { type: 'state'; state: UiState }
  | GraphHostMessage
  | RefsHostMessage
  | WorkingCopyHostMessage
  | CommitTreeHostMessage
  | CommitDetailsHostMessage
  | RebaseHostMessage
  | OperationFormModalHostMessage
  | PathHistoryHostMessage
  | ChangesHostMessage
  | MergeHostMessage;

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'openQuickLaunch' }
  | { type: 'openTerminal' }
  | { type: 'openGitHubLink'; url: string }
  | GraphWebviewMessage
  | SyncWebviewMessage
  | DailyGitWebviewMessage
  | HistoryWebviewMessage
  | WorkingCopyWebviewMessage
  | CommitTreeWebviewMessage
  | CommitDetailsWebviewMessage
  | PatchWebviewMessage
  | RebaseWebviewMessage
  | OperationFormModalWebviewMessage
  | PathHistoryWebviewMessage
  /** A diff toolbar button was pressed in the Commit, Changes or Tree tab. */
  | { type: 'diffViewOption'; option: DiffViewOption }
  | ChangesWebviewMessage
  | MergeWebviewMessage
  | StashWebviewMessage;
