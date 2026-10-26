const COMMIT_MESSAGES = new Set([
  'bootstrap',
  'state',
  'refsCompareResult',
  'workingCopySnapshot',
  'workingCopyFileDiff',
  'workingCopyBinaryChunk',
  'workingCopyFocus',
  'workingCopyRevealDiff',
  'commitDetailsPreview',
  'commitComparePreview',
  'commitDetails',
  'commitDetailsFileDiff',
  'editorTokenColors',
  'commitDiffView',
  'commitDiffNavigate',
  'commitDetailsShowFile',
]);

/** The commit summary and file list beside the diff. */
const FILES_MESSAGES = new Set([
  'commitDetailsPreview',
  'commitComparePreview',
  'commitDetails',
  'graphMeta',
  'graphAvatars',
]);

/** The Tree tab's preview of the selected file. */
const TREE_PREVIEW_MESSAGES = new Set(['commitTreeFilePreview', 'commitTreePreviewClear', 'commitDiffView']);

/** The working-copy Changes tab: the lists of changes, and the diff options its toolbar shares. */
const CHANGES_MESSAGES = new Set(['workingCopySnapshot', 'commitDiffView']);

export type BottomView = 'commit' | 'files' | 'treePreview' | 'changes';

/** Which bottom-panel webviews should receive this host message. */
export function bottomViewsFor(type: string): BottomView[] {
  const views: BottomView[] = [];
  if (COMMIT_MESSAGES.has(type)) {
    views.push('commit');
  }
  if (FILES_MESSAGES.has(type)) {
    views.push('files');
  }
  if (TREE_PREVIEW_MESSAGES.has(type)) {
    views.push('treePreview');
  }
  if (CHANGES_MESSAGES.has(type)) {
    views.push('changes');
  }
  return views;
}
