import type { CommitDiffViewOptions } from '../diff/commitDiffPresentation';
import type { EditorTokenColors } from '../diff/editorTokenColors';
import type { GraphCommitDto } from '../graph/graphProtocol';
import type { WorkingCopyFileDiffDto } from '../changes/workingCopyProtocol';

export interface CommitFileChangeDto {
  /** `git diff-tree --name-status` token, such as `M`, `A`, or `R100`. */
  status: string;
  path: string;
  oldPath?: string;
}

export interface CommitPersonDto {
  name: string;
  email: string;
  /** Unix seconds. Zero when git did not report a date. */
  date: number;
}

export interface CommitDiffLineDto {
  kind: 'add' | 'del' | 'context' | 'hunk';
  text: string;
  /** Editor line number: the new file for additions and context, the old file for deletions. */
  line?: number;
  /** The file has no newline after this line (git's `\ No newline at end of file`). */
  noEol?: boolean;
}

export interface CommitDetailsDto {
  sha: string;
  files: CommitFileChangeDto[];
  /** Commit message body (`git log -1 --format=%b`), without the subject line. */
  body: string;
  committer: CommitPersonDto;
  /** Set when the files are the changes from this commit to `sha` instead of one commit's own changes. */
  baseSha?: string;
}

export type CommitDetailsHostMessage =
  | { type: 'commitDetailsPreview'; commit: GraphCommitDto }
  | { type: 'commitComparePreview'; base: GraphCommitDto; commit: GraphCommitDto }
  | { type: 'commitDetails'; details: CommitDetailsDto }
  | {
      type: 'commitDetailsFileDiff';
      sha: string;
      baseSha?: string;
      path: string;
      binary: boolean;
      lines: CommitDiffLineDto[];
      /** Set when the diff could not be read; shown instead of the (empty) lines. */
      error?: string;
      /** Before and after of a binary file, when it can be previewed. */
      nonText?: WorkingCopyFileDiffDto;
    }
  | { type: 'editorTokenColors'; colors: EditorTokenColors }
  | { type: 'commitDiffView'; options: CommitDiffViewOptions }
  | { type: 'commitDiffNavigate'; direction: 'previous' | 'next' }
  /** `reset` drops icons sent before, when the icon theme changed. */
  /** The file list selected a file; its diff follows as `commitDetailsFileDiff`. */
  | { type: 'commitDetailsShowFile'; sha: string; baseSha?: string; path: string };

export type CommitDetailsWebviewMessage =
  | { type: 'commitDetailsPreview'; commit: GraphCommitDto }
  /** Two commits are selected: show the changes from `base` (the older) to `commit`. */
  | { type: 'commitComparePreview'; base: GraphCommitDto; commit: GraphCommitDto }
  | { type: 'commitViewReady' }
  | { type: 'commitFilesReady' }
  /** Open the file as it was at `sha` (or before its deletion) in an editor. */
  | { type: 'commitFileOpen'; sha: string; baseSha?: string; path: string; status: string; oldPath?: string }
  /** The file list selected a file in the shown commit or comparison. */
  | { type: 'commitDetailsSelectFile'; sha: string; baseSha?: string; path: string }
  | { type: 'commitDetailsSelect'; sha: string; baseSha?: string }
  | {
      type: 'commitDetailsOpenFile';
      sha: string;
      baseSha?: string;
      path: string;
      status: string;
      oldPath?: string;
    };
