/** The commit a revision names, shown above the file list. */
export interface CommitTreeRevisionDto {
  sha: string;
  author: string;
  email: string;
  /** Unix seconds. */
  date: number;
  subject: string;
}

export interface CommitTreePageDto {
  revision: string;
  /** Every file at the revision. */
  paths: string[];
  /** The commit at this revision, when it names one. */
  commit?: CommitTreeRevisionDto;
}

export interface CommitTreeFilePreviewDto {
  revision: string;
  path: string;
  text: string;
  error?: string;
}

export type CommitTreeHostMessage =
  | { type: 'commitTreeFilePreview'; preview: CommitTreeFilePreviewDto }
  /** A different revision is listed: the preview of the previous one no longer applies. */
  | { type: 'commitTreePreviewClear' };

export type CommitTreeWebviewMessage =
  /** The Preview view finished loading. */
  | { type: 'treeViewReady' }
  | { type: 'commitTreeSetRevision'; revision: string }
  | { type: 'commitTreeOpen'; revision: string; path: string }
  /** Open the file at the revision in a read-only editor tab. */
  | { type: 'commitTreeOpenInEditor'; revision: string; path: string };
