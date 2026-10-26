import type { RebaseCommitCommand, RebaseTodoCommitLine, RebaseTodoLine } from './rebaseTodo';

export function squashLastN(
  lines: readonly RebaseTodoLine[],
  n: number,
  mode: 'squash' | 'fixup' = 'squash',
): RebaseTodoLine[] {
  if (n < 2) {
    return [...lines];
  }
  const commits = lines.filter((l): l is RebaseTodoCommitLine => l.kind === 'commit');
  if (commits.length < n) {
    return [...lines];
  }
  const targetHashes = new Set(commits.slice(-n).map((c) => c.hash));
  return lines.map((line) => {
    if (line.kind !== 'commit' || !targetHashes.has(line.hash)) {
      return line;
    }
    const index = commits.findIndex((c) => c.hash === line.hash);
    const start = commits.length - n;
    if (index === start) {
      return line;
    }
    if (index > start) {
      return { ...line, command: mode };
    }
    return line;
  });
}

export function combineSelected(
  lines: readonly RebaseTodoLine[],
  selectedHashes: ReadonlySet<string>,
  mode: 'squash' | 'fixup',
): RebaseTodoLine[] {
  const commits = lines.filter((l): l is RebaseTodoCommitLine => l.kind === 'commit');
  const selected = commits.filter((c) => selectedHashes.has(c.hash));
  if (selected.length < 2) {
    return [...lines];
  }
  const firstHash = selected[0].hash;
  return lines.map((line) => {
    if (line.kind !== 'commit' || !selectedHashes.has(line.hash)) {
      return line;
    }
    if (line.hash === firstHash) {
      return line;
    }
    return { ...line, command: mode };
  });
}

/** Turn fixup! / squash! subjects into fixup/squash commands (autosquash). */
export function applyAutosquashCommands(lines: readonly RebaseTodoLine[]): RebaseTodoLine[] {
  const out: RebaseTodoLine[] = [];
  let lastPick: RebaseTodoCommitLine | null = null;
  for (const line of lines) {
    if (line.kind !== 'commit') {
      out.push(line);
      continue;
    }
    const autosquash = parseAutosquashSubject(line.subject);
    if (autosquash && lastPick) {
      out.push({ ...line, command: autosquash });
      continue;
    }
    out.push(line);
    if (line.command === 'pick' || line.command === 'reword' || line.command === 'edit') {
      lastPick = line;
    }
  }
  return out;
}

function parseAutosquashSubject(subject: string): RebaseCommitCommand | null {
  const trimmed = subject.trimStart();
  if (trimmed.startsWith('fixup! ')) {
    return 'fixup';
  }
  if (trimmed.startsWith('squash! ')) {
    return 'squash';
  }
  return null;
}

export function reorderCommitLines(
  lines: readonly RebaseTodoLine[],
  fromIndex: number,
  toIndex: number,
): RebaseTodoLine[] {
  const prefix: RebaseTodoLine[] = [];
  const commits: RebaseTodoCommitLine[] = [];
  const suffix: RebaseTodoLine[] = [];
  let seenCommit = false;
  for (const line of lines) {
    if (line.kind === 'commit') {
      commits.push(line);
      seenCommit = true;
    } else if (!seenCommit) {
      prefix.push(line);
    } else {
      suffix.push(line);
    }
  }
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= commits.length ||
    toIndex >= commits.length ||
    fromIndex === toIndex
  ) {
    return [...lines];
  }
  const reordered = [...commits];
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);
  return [...prefix, ...reordered, ...suffix];
}
