export type DiffViewLayout = 'unified' | 'sideBySide';

export type DiffWhitespaceMode = 'normal' | 'show' | 'ignore';

export type ImageDiffMode = 'sideBySide' | 'swipe' | 'onion' | 'pixel';

export interface WorkingCopyDiffViewOptions {
  layout: DiffViewLayout;
  whitespace: DiffWhitespaceMode;
  wordDiff: boolean;
  imageMode: ImageDiffMode;
}

export const DEFAULT_WORKING_COPY_DIFF_VIEW_OPTIONS: WorkingCopyDiffViewOptions = {
  layout: 'unified',
  whitespace: 'normal',
  wordDiff: false,
  imageMode: 'sideBySide',
};
