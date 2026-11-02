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

/** The Tree tab's preview of the selected file. */
const TREE_PREVIEW_MESSAGES = new Set(['commitTreeFilePreview', 'commitTreePreviewClear', 'commitDiffView']);

/** The working-copy Changes tab: the lists of changes, and the diff options its toolbar shares. */
const CHANGES_MESSAGES = new Set(['workingCopySnapshot', 'commitDiffView']);

export type SlotName = 'commit' | 'treePreview' | 'changes';

/** Which webview slots should receive this host message. */
export function slotsFor(type: string): SlotName[] {
  const views: SlotName[] = [];
  if (COMMIT_MESSAGES.has(type)) {
    views.push('commit');
  }
  if (TREE_PREVIEW_MESSAGES.has(type)) {
    views.push('treePreview');
  }
  if (CHANGES_MESSAGES.has(type)) {
    views.push('changes');
  }
  return views;
}

/** What only the commit form of the Changes needs. */
const CHANGES_FORM_ONLY = new Set(['changesSubjectLimits', 'changesShortcut', 'changesGenerating', 'changesGeneratedMessage', 'changesAmendMessage', 'changesCommitted']);

/** What only the diff tab of the Changes needs. */
const CHANGES_DIFF_ONLY = new Set(['changesSelection', 'commitDiffView', 'editorTokenColors', 'changesDiff', 'changesConflict']);

/** The pages of the Changes that take a message: the commit form and the diff tab share the rest of what the host sends. */
export function changesPagesFor(type: string): ('form' | 'diff')[] {
  if (CHANGES_FORM_ONLY.has(type)) {
    return ['form'];
  }
  return CHANGES_DIFF_ONLY.has(type) ? ['diff'] : ['form', 'diff'];
}
