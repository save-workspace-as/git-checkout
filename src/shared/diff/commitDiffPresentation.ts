import type { CommitDiffLineDto } from '../history/commitDetailsProtocol';

/** How the commit diff is shown. Whitespace and context are applied by git; the rest by the viewer. */
export interface CommitDiffViewOptions {
  /** Hide changes that only differ in whitespace (`git diff -w`). */
  ignoreWhitespace: boolean;
  /** Unchanged lines shown around each change. */
  contextLines: number;
  /** Show the whole file with its changes instead of only the surroundings of each change. */
  fullFile: boolean;
  /** Draw spaces, tabs and line ends. */
  showInvisibles: boolean;
  /** Wrap long lines instead of scrolling sideways. */
  wrapLines: boolean;
  sideBySide: boolean;
  /** When side by side, put the new file on the left. */
  swapped: boolean;
  /** Color code by language; `gitCheckout.diff.syntaxHighlighting`, so not kept with the toggles above. */
  syntaxHighlighting?: boolean;
  /** Show + and − beside added and removed lines; `gitCheckout.diff.changeMarks`. */
  changeMarks?: boolean;
}

export const DEFAULT_COMMIT_DIFF_VIEW: CommitDiffViewOptions = {
  ignoreWhitespace: false,
  contextLines: 3,
  fullFile: false,
  showInvisibles: false,
  wrapLines: false,
  sideBySide: false,
  swapped: false,
};

const CONTEXT_LEVELS = [0, 1, 3, 6, 12, 24, 48, 96];
/** Large enough that git shows every line of any realistic file. */
const FULL_FILE_CONTEXT = 1_000_000;

/** The next context size up or down the levels, staying within them. */
export function stepContextLines(current: number, direction: 1 | -1): number {
  const index = CONTEXT_LEVELS.findIndex((level) => level >= current);
  const at = index < 0 ? CONTEXT_LEVELS.length - 1 : index;
  if (direction === 1) {
    return CONTEXT_LEVELS[Math.min(CONTEXT_LEVELS.length - 1, CONTEXT_LEVELS[at] > current ? at : at + 1)];
  }
  return CONTEXT_LEVELS[Math.max(0, at - 1)];
}

/** `git diff` arguments that produce this view's lines. */
export function commitDiffGitArgs(options: CommitDiffViewOptions): string[] {
  return [
    `-U${options.fullFile ? FULL_FILE_CONTEXT : options.contextLines}`,
    ...(options.ignoreWhitespace ? ['-w'] : []),
  ];
}

export type DiffRow =
  | { type: 'hunk'; text: string }
  | { type: 'inline'; index: number }
  | { type: 'pair'; left?: number; right?: number };

/** Turns unified diff lines into inline or side-by-side rows for the commit diff. */
export function presentDiffLines(lines: CommitDiffLineDto[], options: CommitDiffViewOptions): DiffRow[] {
  const visible = lines.map((_, index) => index);
  const rows: DiffRow[] = [];
  let cursor = 0;
  while (cursor < visible.length) {
    const index = visible[cursor] ?? 0;
    const line = lines[index];
    if (!line) {
      cursor += 1;
      continue;
    }
    if (line.kind === 'hunk') {
      rows.push({ type: 'hunk', text: line.text });
      cursor += 1;
      continue;
    }
    if (options.sideBySide && (line.kind === 'del' || line.kind === 'add')) {
      const deletions: number[] = [];
      const additions: number[] = [];
      while (lines[visible[cursor] ?? 0]?.kind === 'del') {
        deletions.push(visible[cursor] ?? 0);
        cursor += 1;
      }
      while (lines[visible[cursor] ?? 0]?.kind === 'add') {
        additions.push(visible[cursor] ?? 0);
        cursor += 1;
      }
      const count = Math.max(deletions.length, additions.length);
      for (let offset = 0; offset < count; offset += 1) {
        const before = deletions[offset];
        const after = additions[offset];
        rows.push(
          options.swapped
            ? { type: 'pair', left: after, right: before }
            : { type: 'pair', left: before, right: after },
        );
      }
      continue;
    }
    pushLine(rows, lines, index, options);
    cursor += 1;
  }
  return rows;
}

function pushLine(
  rows: DiffRow[],
  lines: CommitDiffLineDto[],
  index: number,
  options: CommitDiffViewOptions,
): void {
  if (options.sideBySide && lines[index]?.kind === 'context') {
    rows.push({ type: 'pair', left: index, right: index });
    return;
  }
  rows.push({ type: 'inline', index });
}

/** Restores saved view options, ignoring anything that is missing or has the wrong type. */
export function parseStoredDiffView(value: unknown): CommitDiffViewOptions {
  const stored = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const flag = (key: keyof CommitDiffViewOptions): boolean =>
    typeof stored[key] === 'boolean' ? stored[key] : (DEFAULT_COMMIT_DIFF_VIEW[key] as boolean);
  const context = stored.contextLines;
  return {
    ignoreWhitespace: flag('ignoreWhitespace'),
    contextLines:
      typeof context === 'number' && Number.isInteger(context) && context >= 0 && context <= 96
        ? context
        : DEFAULT_COMMIT_DIFF_VIEW.contextLines,
    fullFile: flag('fullFile'),
    showInvisibles: flag('showInvisibles'),
    wrapLines: flag('wrapLines'),
    sideBySide: flag('sideBySide'),
    swapped: flag('sideBySide') && flag('swapped'),
  };
}
