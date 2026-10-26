export type DiffLineKind = 'context' | 'add' | 'del' | 'noNewline';

export interface ParsedDiffLine {
  kind: DiffLineKind;
  /** Full source line from git diff (includes +/- prefix when applicable). */
  raw: string;
  oldLineNo: number | null;
  newLineNo: number | null;
}

export interface ParsedDiffHunk {
  headerLine: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: ParsedDiffLine[];
}

export interface ParsedDiffFile {
  oldPath: string;
  newPath: string;
  binary: boolean;
  /** Lines before the first hunk (`diff --git`, `index`, `---` / `+++`, etc.). */
  preamble: string[];
  hunks: ParsedDiffHunk[];
}

export interface ParseUnifiedDiffResult {
  files: ParsedDiffFile[];
  /** Non-fatal issues (for example skip-worktree paths with no diff text). */
  warnings: string[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseUnifiedDiff(input: string): ParseUnifiedDiffResult {
  const warnings: string[] = [];
  if (!input.trim()) {
    return { files: [], warnings };
  }

  const normalized = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rawLines = normalized.split('\n');
  const files: ParsedDiffFile[] = [];
  let i = 0;

  while (i < rawLines.length) {
    const line = rawLines[i];
    if (!line.startsWith('diff --git ')) {
      i++;
      continue;
    }

    const paths = parseDiffGitLine(line);
    if (!paths) {
      warnings.push('Skipped malformed diff --git header.');
      i++;
      continue;
    }

    const preamble: string[] = [line];
    i++;
    let binary = false;

    while (i < rawLines.length && !rawLines[i].startsWith('@@')) {
      const headerLine = rawLines[i];
      if (headerLine.startsWith('diff --git ')) {
        break;
      }
      preamble.push(headerLine);
      if (/^Binary files /.test(headerLine) || /^GIT binary patch/.test(headerLine)) {
        binary = true;
      }
      i++;
    }

    const hunks: ParsedDiffHunk[] = [];
    if (!binary) {
      while (i < rawLines.length && rawLines[i].startsWith('@@')) {
        const parsed = parseHunk(rawLines, i);
        if (!parsed) {
          warnings.push('Skipped malformed hunk header.');
          i++;
          break;
        }
        hunks.push(parsed.hunk);
        i = parsed.nextIndex;
      }
    } else {
      while (i < rawLines.length && !rawLines[i].startsWith('diff --git ')) {
        i++;
      }
    }

    files.push({
      oldPath: paths.oldPath,
      newPath: paths.newPath,
      binary,
      preamble,
      hunks,
    });
  }

  return { files, warnings };
}

function parseDiffGitLine(line: string): { oldPath: string; newPath: string } | null {
  const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
  if (!match) {
    const quoted = /^diff --git "a\/(.+)" "b\/(.+)"$/.exec(line);
    if (!quoted) {
      return null;
    }
    return { oldPath: unquoteGitPath(quoted[1]), newPath: unquoteGitPath(quoted[2]) };
  }
  return { oldPath: match[1], newPath: match[2] };
}

function unquoteGitPath(raw: string): string {
  return raw.replace(/\\([0-7]{3}|n|r|t|\\|")/g, (_full, esc: string) => {
    switch (esc) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case '\\':
        return '\\';
      case '"':
        return '"';
      default:
        return String.fromCharCode(parseInt(esc, 8));
    }
  });
}

function parseHunk(
  lines: string[],
  startIndex: number,
): { hunk: ParsedDiffHunk; nextIndex: number } | null {
  const headerLine = lines[startIndex];
  const match = HUNK_HEADER.exec(headerLine);
  if (!match) {
    return null;
  }

  const oldStart = Number(match[1]);
  const oldCount = match[2] ? Number(match[2]) : 1;
  const newStart = Number(match[3]);
  const newCount = match[4] ? Number(match[4]) : 1;

  const hunkLines: ParsedDiffLine[] = [];
  let oldLine = oldStart;
  let newLine = newStart;
  let i = startIndex + 1;

  while (i < lines.length) {
    const raw = lines[i];
    if (raw.startsWith('diff --git ') || raw.startsWith('@@')) {
      break;
    }
    if (raw === '') {
      i++;
      continue;
    }

    if (raw.startsWith('\\')) {
      hunkLines.push({
        kind: 'noNewline',
        raw,
        oldLineNo: null,
        newLineNo: null,
      });
      i++;
      continue;
    }

    const prefix = raw[0];
    if (prefix === ' ') {
      hunkLines.push({
        kind: 'context',
        raw,
        oldLineNo: oldLine,
        newLineNo: newLine,
      });
      oldLine++;
      newLine++;
    } else if (prefix === '-') {
      hunkLines.push({
        kind: 'del',
        raw,
        oldLineNo: oldLine,
        newLineNo: null,
      });
      oldLine++;
    } else if (prefix === '+') {
      hunkLines.push({
        kind: 'add',
        raw,
        oldLineNo: null,
        newLineNo: newLine,
      });
      newLine++;
    } else {
      break;
    }
    i++;
  }

  return {
    hunk: {
      headerLine,
      oldStart,
      oldCount,
      newStart,
      newCount,
      lines: hunkLines,
    },
    nextIndex: i,
  };
}

export function findDiffFileForPath(files: ParsedDiffFile[], repoPath: string): ParsedDiffFile | undefined {
  const normalized = repoPath.replace(/\\/g, '/');
  return files.find(
    (file) =>
      file.newPath === normalized ||
      file.oldPath === normalized ||
      file.newPath.endsWith(`/${normalized}`) ||
      file.oldPath.endsWith(`/${normalized}`),
  );
}
