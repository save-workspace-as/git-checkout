import type { BinaryBlobSlice } from '../diff/binaryPayload';
import type { ImageDiffMode, WorkingCopyDiffViewOptions } from '../diff/diffViewOptions';
import type { LfsPointerFields } from '../diff/lfsPointer';

export type WorkingCopyGroup = 'staged' | 'unstaged' | 'untracked';

export type WorkingCopyStatusLabel =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'ignored'
  | 'intent-to-add'
  | 'intent-to-rename'
  | 'type-changed'
  | 'conflict'
  | 'unknown';

export interface WorkingCopyEntryDto {
  path: string;
  group: WorkingCopyGroup;
  status: WorkingCopyStatusLabel;
  originalPath?: string;
  /** True when the index mode is a gitlink (160000). */
  submodule?: boolean;
}

export interface WorkingCopyFlagDto {
  path: string;
  assumeUnchanged: boolean;
  skipWorktree: boolean;
}

export interface WorkingCopySnapshotDto {
  entries: WorkingCopyEntryDto[];
  flags: WorkingCopyFlagDto[];
  /** The checked-out branch; absent on a detached HEAD. */
  branch?: string;
}

export const EMPTY_WORKING_COPY: WorkingCopySnapshotDto = { entries: [], flags: [] };

export type WorkingCopyAction =
  | { op: 'stage'; path: string }
  | { op: 'unstage'; path: string }
  | { op: 'discard'; path: string }
  | { op: 'assumeUnchanged'; path: string; enabled: boolean }
  | { op: 'skipWorktree'; path: string; enabled: boolean };

export type WorkingCopyDiffSide = 'unstaged' | 'staged';

export type WorkingCopyDiffLineKind = 'context' | 'add' | 'del';

export interface WorkingCopyDiffLineDto {
  id: string;
  kind: WorkingCopyDiffLineKind;
  text: string;
  selectable: boolean;
}

export interface WorkingCopyDiffHunkDto {
  id: string;
  header: string;
  lines: WorkingCopyDiffLineDto[];
}

export type WorkingCopyNonTextKind = 'none' | 'image' | 'binary' | 'lfs' | 'submodule';

export interface WorkingCopyBinaryBlobDto {
  side: 'old' | 'new';
  mimeType?: string;
  byteLength: number;
  blobRef: string;
  inline?: BinaryBlobSlice;
  lfs?: LfsPointerFields;
}

export interface WorkingCopyLfsComparisonDto {
  old?: LfsPointerFields;
  new?: LfsPointerFields;
}

export interface WorkingCopySubmoduleCommitDto {
  sha: string;
  subject: string;
}

export interface WorkingCopySubmoduleDiffDto {
  oldSha: string;
  newSha: string;
  commits: WorkingCopySubmoduleCommitDto[];
}

export interface WorkingCopyFileDiffDto {
  path: string;
  side: WorkingCopyDiffSide;
  binary: boolean;
  nonTextKind: WorkingCopyNonTextKind;
  imageMode?: ImageDiffMode;
  blobs?: WorkingCopyBinaryBlobDto[];
  lfsComparison?: WorkingCopyLfsComparisonDto;
  submodule?: WorkingCopySubmoduleDiffDto;
  hunks: WorkingCopyDiffHunkDto[];
  warnings?: string[];
  error?: string;
}

export type WorkingCopyPatchAction =
  | { op: 'stageHunk'; path: string; hunkId: string }
  | { op: 'stageLine'; path: string; lineId: string }
  | { op: 'unstageHunk'; path: string; hunkId: string }
  | { op: 'unstageLine'; path: string; lineId: string }
  | { op: 'discardHunk'; path: string; hunkId: string }
  | { op: 'discardLine'; path: string; lineId: string }
  | { op: 'stashHunk'; path: string; hunkId: string; side: WorkingCopyDiffSide }
  | { op: 'stashLine'; path: string; lineId: string; side: WorkingCopyDiffSide };

export type WorkingCopyHostMessage =
  | { type: 'workingCopySnapshot'; snapshot: WorkingCopySnapshotDto }
  | { type: 'workingCopyFileDiff'; diff: WorkingCopyFileDiffDto }
  | { type: 'workingCopyBinaryChunk'; blobRef: string; chunk: BinaryBlobSlice }
  | { type: 'workingCopyFocus' }
  | { type: 'workingCopyRevealDiff'; path: string; side: WorkingCopyDiffSide };

export type WorkingCopyWebviewMessage =
  | { type: 'workingCopyReady' }
  | { type: 'workingCopyAction'; action: WorkingCopyAction }
  | {
      type: 'workingCopyRequestDiff';
      path: string;
      side: WorkingCopyDiffSide;
      options: WorkingCopyDiffViewOptions;
    }
  | { type: 'workingCopyOpenInDiffEditor'; path: string; side: WorkingCopyDiffSide }
  | {
      type: 'workingCopyRequestBinaryChunk';
      blobRef: string;
      offset: number;
      maxBytes?: number;
    }
  | { type: 'workingCopyPatchAction'; action: WorkingCopyPatchAction };
