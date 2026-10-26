import type { RepoOperationKind } from '../history/historyProtocol';

export type ConflictScenario =
  | 'both-modified'
  | 'both-added'
  | 'both-deleted'
  | 'deleted-by-us'
  | 'deleted-by-them'
  | 'added-by-us'
  | 'added-by-them';

export type ConflictFileKind = 'text' | 'binary' | 'submodule';

export interface ConflictFileDto {
  path: string;
  scenario: ConflictScenario;
  kind: ConflictFileKind;
  badge: string;
  guidance: string;
  mergeEditorSupported: boolean;
}

export interface ConflictHelperStateDto {
  repoRoot: string;
  operationKind: RepoOperationKind;
  operationSummary: string;
  files: ConflictFileDto[];
  selectedIndex: number;
  continueCommand: string;
  abortCommand: string;
  allResolved: boolean;
}
