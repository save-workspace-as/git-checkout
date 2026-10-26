import type { BisectStateDto } from '../bisect/bisectProtocol';
import type { GitHubRepository } from '../history/githubReferences';

export const ALL_COMMITS_FILTER = '--all';

export type GraphOrder = 'date' | 'topo';

export type GraphRefKind = 'head' | 'local' | 'remote' | 'tag' | 'stash';

export interface GraphRefDto {
  kind: GraphRefKind;
  name: string;
  /** True for the local branch HEAD points at. */
  isHead?: boolean;
  /** Remote-tracking branches of the same name on the same commit, drawn in this label when labels are compact. */
  remotes?: string[];
}

export interface GraphCommitDto {
  sha: string;
  parents: string[];
  subject: string;
  author: string;
  authorEmail: string;
  authorDate: number;
  refs: GraphRefDto[];
  /** Reached only through a reflog: no branch, tag, or stash contains it. */
  reflogOnly?: boolean;
  avatarUrl?: string;
}

export interface GraphPageDto {
  commits: GraphCommitDto[];
  hasMore: boolean;
  filterRef: string;
  oldestSha: string | null;
  activeBranchOnly: boolean;
  /** When true, merge commits start collapsed and can be expanded from the node. */
  collapseMerges: boolean;
}

/** `data-vscode-context` on a graph row; VS Code passes it to `webview/context` commands. */
export interface GraphCommitContext {
  webviewSection: 'commit';
  graphSelection: 'single' | 'multi';
  sha: string;
  subject: string;
  /** Selected commits in graph order (newest first). */
  shas: string[];
  /** Set when this commit is a `stash@{n}` entry. */
  stashSelector?: string;
  /** The branch the Branch submenu acts on: the badge that was right-clicked, else the commit's own branch. */
  graphBranch?: string;
  graphBranchKind?: 'local' | 'remote';
  /** The commit's own name to start a branch from, when it has one: a branch, else a tag. */
  graphStartRef?: string;
  preventDefaultContextMenuItems: true;
}

/** What a right-click on one ref badge adds to its row's context, so the menu acts on that branch. */
export interface GraphRefContext {
  graphBranch: string;
  graphBranchKind: 'local' | 'remote';
  preventDefaultContextMenuItems: true;
}

export type GraphHostMessage =
  /** `keepView` replaces the list in place: a refresh that keeps the scroll position and selection. */
  | { type: 'graphPage'; page: GraphPageDto; append: boolean; keepView?: boolean }
  | {
      type: 'graphMeta';
      filterRef: string;
      headRef: string | null;
      activeBranchOnly: boolean;
      collapseMerges: boolean;
      /** One label for a local branch and its remote-tracking branches on the same commit. */
      compactBranchLabels?: boolean;
      /** True while the graph also lists commits that only the reflog reaches. */
      showReflog: boolean;
      /** GitHub remote used to link `#n` references, or null when the remote is not GitHub. */
      github: GitHubRepository | null;
    }
  | { type: 'graphReveal'; ref: string; sha: string; reachable: boolean }
  | { type: 'graphFocusSearch'; query?: string }
  /** A keyboard shortcut for the selected commit: step through search matches, copy it, or remove its branch or stash. */
  | { type: 'graphShortcut'; action: 'findNext' | 'findPrevious' | 'copy' | 'remove' }
  /**
   * A batch of matches in graph order. Search runs in the background and reports as it goes, so
   * batches keep arriving until `done`. `positions[i]` is where `shas[i]` sits in the graph.
   */
  | { type: 'graphFindResult'; query: string; shas: string[]; positions: number[]; done: boolean }
  | { type: 'graphBisect'; state: BisectStateDto }
  | { type: 'graphLoadFailed' }
  /** The commits a collapsed merge brought in, for showing it expanded. */
  | { type: 'graphMergeSide'; sha: string; commits: GraphCommitDto[] }
  /** GitHub profile pictures found for authors, by lowercase email address. */
  | { type: 'graphAvatars'; avatars: Record<string, string> }
  | { type: 'graphClear' };

export type GraphWebviewMessage =
  | { type: 'graphReady' }
  | { type: 'graphLoadMore' }
  | { type: 'graphSetFilter'; ref: string }
  | { type: 'graphFind'; query: string }
  | { type: 'graphFindCancel' }
  /** Load every commit down to graph position `index` (a distant search match). */
  | { type: 'graphLoadThrough'; index: number }
  | { type: 'graphCopy'; text: string }
  /** Run a graph context-menu command on the commit a keyboard shortcut acted on. */
  | { type: 'graphContextCommand'; id: string; context: GraphCommitContext }
  | { type: 'graphExitReflog' }
  | { type: 'graphExitActiveBranchOnly' }
  | { type: 'graphExpandMerge'; sha: string };
