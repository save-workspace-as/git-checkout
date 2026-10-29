/**
 * The one codicon for each action, wherever it appears: view and editor title buttons, context
 * menus, and the buttons inside webviews. Add an action here before giving it an icon, and use the
 * same entry for every place that offers it.
 */
export const ACTION_ICONS = {
  openDiff: 'compare-changes',
  openFile: 'go-to-file',
  stage: 'add',
  unstage: 'remove',
  discard: 'discard',
  generateMessage: 'sparkle',
  ignoreWhitespace: 'whitespace',
  showInvisibles: 'eye',
  wrapLines: 'word-wrap',
  moreContext: 'unfold',
  lessContext: 'fold',
  fullFile: 'screen-full',
  sideBySide: 'split-horizontal',
  previousChange: 'arrow-up',
  nextChange: 'arrow-down',
  swapSides: 'arrow-swap',
  mergeLayout: 'layout',
  fileTree: 'list-tree',
  fileList: 'list-flat',
  untrackedFiles: 'new-file',
  ignoredFiles: 'exclude',
  collapseMerges: 'collapse-all',
  showAllMerges: 'expand-all',
  reflog: 'book',
  fileHistory: 'history',
  blame: 'git-commit',
  olderCommit: 'chevron-left',
  newerCommit: 'chevron-right',
  search: 'search',
  branch: 'git-branch',
  remoteBranch: 'cloud',
  tag: 'tag',
  stash: 'git-stash',
  copy: 'copy',
  file: 'file',
  folder: 'folder',
  folderOpen: 'folder-opened',
} as const;

export type ActionIcon = keyof typeof ACTION_ICONS;
