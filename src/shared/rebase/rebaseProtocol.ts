import type { GitHubRepository } from '../history/githubReferences';
import type { GraphCommitDto } from '../graph/graphProtocol';
import type { CommitPersonDto } from '../history/commitDetailsProtocol';

export type RebaseCommitCommand = 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop';

export interface RebaseTodoCommitDto {
  command: RebaseCommitCommand;
  hash: string;
  subject: string;
  message?: string;
}

export interface RebaseSequencerDto {
  active: boolean;
  onto: string | null;
  headName: string | null;
  msgnum: number;
  end: number;
  summary: string;
}

export interface RebaseEditorStateDto {
  repoRoot: string;
  onto: string;
  upstream: string;
  updateRefs: boolean;
  stashDirty: boolean;
  lines: RebaseTodoCommitDto[];
  sequencer: RebaseSequencerDto;
  riskyCount: number;
  github: GitHubRepository | null;
  branch: string | null;
  commits: GraphCommitDto[];
  reorderId?: number;
}

export type RebaseHostMessage =
  | { type: 'rebaseBootstrap'; state: RebaseEditorStateDto }
  | { type: 'rebaseState'; state: RebaseEditorStateDto }
  | { type: 'rebaseCommitDetails'; hash: string; body: string; committer: CommitPersonDto }
  | { type: 'rebaseCommitDetailsError'; hash: string; message: string }
  | { type: 'rebaseError'; message: string }
  | { type: 'rebaseClose' };

export type RebaseWebviewMessage =
  | { type: 'rebaseReady' }
  | { type: 'openGitHubLink'; url: string }
  | { type: 'rebaseDismiss' }
  | { type: 'rebaseSetOnto'; onto: string }
  | { type: 'rebaseSetUpstream'; upstream: string }
  | { type: 'rebaseToggleUpdateRefs'; enabled: boolean }
  | { type: 'rebaseToggleStash'; enabled: boolean }
  | { type: 'rebaseSetCommand'; hash: string; command: RebaseCommitCommand }
  | { type: 'rebaseSetMessage'; hash: string; message: string }
  | { type: 'rebaseEditMessage'; hash: string }
  | { type: 'rebaseRequestCommitDetails'; hash: string }
  | { type: 'rebaseReorder'; fromIndex: number; toIndex: number; reorderId?: number }
  | { type: 'rebaseSquashLast'; count: number; mode: 'squash' | 'fixup' }
  | { type: 'rebaseCombineSelected'; hashes: string[]; mode: 'squash' | 'fixup' }
  | { type: 'rebaseAutosquashFixups' }
  | { type: 'rebaseRefresh' }
  | { type: 'rebaseStart' }
  | { type: 'rebaseContinue' }
  | { type: 'rebaseSkip' }
  | { type: 'rebaseAbort' };
