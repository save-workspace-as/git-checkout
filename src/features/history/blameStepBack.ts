/** One changed region of a file, as `@@ -oldStart,oldCount +newStart,newCount @@` says it. */
export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

export interface FileDiffHunks {
  oldPath: string;
  newPath: string;
  hunks: DiffHunk[];
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * The hunks that `git diff -U0 -M` gives for `newPath`, with the path the file had before. Undefined when the diff
 * does not touch that file, or when the file is new, which has no earlier lines to step back to.
 */
export function parseFileHunks(diff: string, newPath: string): FileDiffHunks | undefined {
  let current: FileDiffHunks | undefined;
  let found: FileDiffHunks | undefined;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      current = undefined;
      continue;
    }
    if (line.startsWith('--- ')) {
      const name = line.slice(4);
      current = name === '/dev/null' ? undefined : { oldPath: name.replace(/^a\//, ''), newPath: '', hunks: [] };
      continue;
    }
    if (line.startsWith('+++ ')) {
      const name = line.slice(4).replace(/^b\//, '');
      if (current && name === newPath) {
        current.newPath = name;
        found = current;
      } else {
        current = undefined;
      }
      continue;
    }
    const match = current ? HUNK.exec(line) : null;
    if (current && match) {
      current.hunks.push({
        oldStart: Number(match[1]),
        oldCount: match[2] === undefined ? 1 : Number(match[2]),
        newStart: Number(match[3]),
        newCount: match[4] === undefined ? 1 : Number(match[4]),
      });
    }
  }
  return found;
}

/**
 * Where a line of the new file was before the change: the lines it replaced, or the same line moved by the changes above
 * it. Undefined for a line the change only added, which had no earlier version.
 */
export function previousLines(hunks: readonly DiffHunk[], line: number): { first: number; last: number } | undefined {
  let shift = 0;
  for (const hunk of hunks) {
    if (hunk.newCount > 0 && line >= hunk.newStart && line < hunk.newStart + hunk.newCount) {
      return hunk.oldCount === 0 ? undefined : { first: hunk.oldStart, last: hunk.oldStart + hunk.oldCount - 1 };
    }
    if ((hunk.newCount === 0 ? hunk.newStart + 1 : hunk.newStart + hunk.newCount) <= line) {
      shift += hunk.newCount - hunk.oldCount;
    } else {
      break;
    }
  }
  const old = line - shift;
  return old > 0 ? { first: old, last: old } : undefined;
}
