import type { ParsedDiffFile, ParsedDiffHunk, ParsedDiffLine } from './gitDiffParser';

export function buildFilePatch(
  file: ParsedDiffFile,
  hunkIndices: number[],
  lineFilter?: (hunkIndex: number, lineIndex: number, line: ParsedDiffLine) => boolean,
): string {
  const parts: string[] = [...file.preamble];
  for (const hunkIndex of hunkIndices) {
    const hunk = file.hunks[hunkIndex];
    if (!hunk) {
      continue;
    }
    const lines = lineFilter
      ? filterHunkLines(hunk, hunkIndex, lineFilter)
      : hunk.lines;
    if (lines.length === 0) {
      continue;
    }
    const headerLine =
      lineFilter !== undefined ? rebuildHunkHeader(hunk, lines).headerLine : hunk.headerLine;
    parts.push(headerLine);
    for (const line of lines) {
      parts.push(line.raw);
    }
  }
  if (parts.length === file.preamble.length) {
    return '';
  }
  return `${parts.join('\n')}\n`;
}

export function buildHunkPatch(file: ParsedDiffFile, hunkIndex: number): string {
  return buildFilePatch(file, [hunkIndex]);
}

export function buildLinePatch(file: ParsedDiffFile, hunkIndex: number, lineIndex: number): string {
  return buildFilePatch(file, [hunkIndex], (hi, li) => hi === hunkIndex && li === lineIndex);
}

function filterHunkLines(
  hunk: ParsedDiffHunk,
  hunkIndex: number,
  lineFilter: (hunkIndex: number, lineIndex: number, line: ParsedDiffLine) => boolean,
): ParsedDiffLine[] {
  const selected = new Set<number>();
  for (let i = 0; i < hunk.lines.length; i++) {
    const line = hunk.lines[i];
    if (line.kind === 'add' || line.kind === 'del') {
      if (lineFilter(hunkIndex, i, line)) {
        selected.add(i);
      }
    }
  }
  if (selected.size === 0) {
    return [];
  }

  const indices = [...selected].sort((a, b) => a - b);
  const first = indices[0];
  const last = indices[indices.length - 1];
  const result: ParsedDiffLine[] = [];
  for (let i = 0; i < hunk.lines.length; i++) {
    const line = hunk.lines[i];
    if (i < first || i > last) {
      continue;
    }
    if (line.kind === 'context' || line.kind === 'noNewline') {
      result.push(line);
      continue;
    }
    if (selected.has(i)) {
      result.push(line);
    }
  }
  return result;
}

function rebuildHunkHeader(hunk: ParsedDiffHunk, lines: ParsedDiffLine[]): { headerLine: string } {
  let oldCount = 0;
  let newCount = 0;
  let oldStart: number | null = null;
  let newStart: number | null = null;

  for (const line of lines) {
    if (line.kind === 'context') {
      if (oldStart === null && line.oldLineNo !== null) {
        oldStart = line.oldLineNo;
      }
      if (newStart === null && line.newLineNo !== null) {
        newStart = line.newLineNo;
      }
      oldCount++;
      newCount++;
    } else if (line.kind === 'del') {
      if (oldStart === null && line.oldLineNo !== null) {
        oldStart = line.oldLineNo;
      }
      oldCount++;
    } else if (line.kind === 'add') {
      if (newStart === null && line.newLineNo !== null) {
        newStart = line.newLineNo;
      }
      newCount++;
    }
  }

  const resolvedOldStart = oldStart ?? hunk.oldStart;
  const resolvedNewStart = newStart ?? hunk.newStart;
  const oldPart = oldCount === 1 ? `${resolvedOldStart}` : `${resolvedOldStart},${oldCount}`;
  const newPart = newCount === 1 ? `${resolvedNewStart}` : `${resolvedNewStart},${newCount}`;
  const suffixMatch = /@@.*@@(.*)$/.exec(hunk.headerLine);
  const headerSuffix = suffixMatch?.[1]?.trim() ? ` ${suffixMatch[1].trim()}` : '';
  return {
    headerLine: `@@ -${oldPart} +${newPart} @@${headerSuffix}`,
  };
}
