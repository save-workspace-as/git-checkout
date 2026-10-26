export type RebaseCommitCommand = 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop';

export interface RebaseTodoCommitLine {
  kind: 'commit';
  command: RebaseCommitCommand;
  hash: string;
  subject: string;
  message?: string;
}

export interface RebaseTodoCommentLine {
  kind: 'comment';
  text: string;
}

export interface RebaseTodoMetaLine {
  kind: 'exec' | 'break' | 'label' | 'reset';
  command: 'exec' | 'break' | 'label' | 'reset';
  argument: string;
}

export type RebaseTodoLine = RebaseTodoCommitLine | RebaseTodoCommentLine | RebaseTodoMetaLine;

const COMMIT_LINE =
  /^(pick|reword|edit|squash|fixup|drop)\s+([0-9a-fA-F]{4,40})\s+(.*)$/;

const META_LINE = /^(exec|break|label|reset)\s+(.*)$/;

export function buildPickLines(
  commits: readonly { hash: string; subject: string }[],
): RebaseTodoCommitLine[] {
  return commits.map((c) => ({
    kind: 'commit',
    command: 'pick',
    hash: c.hash,
    subject: c.subject,
  }));
}

export function parseRebaseTodo(text: string): RebaseTodoLine[] {
  const lines: RebaseTodoLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      continue;
    }
    if (line.startsWith('#')) {
      lines.push({ kind: 'comment', text: line });
      continue;
    }
    const commit = COMMIT_LINE.exec(line.trim());
    if (commit) {
      lines.push({
        kind: 'commit',
        command: commit[1] as RebaseCommitCommand,
        hash: commit[2],
        subject: commit[3],
      });
      continue;
    }
    const meta = META_LINE.exec(line.trim());
    if (meta) {
      const command = meta[1] as RebaseTodoMetaLine['command'];
      lines.push({
        kind: command,
        command,
        argument: meta[2],
      });
      continue;
    }
    lines.push({ kind: 'comment', text: line });
  }
  return lines;
}

export function serializeRebaseTodo(lines: readonly RebaseTodoLine[]): string {
  const out: string[] = [];
  for (const line of lines) {
    if (line.kind === 'comment') {
      out.push(line.text);
      continue;
    }
    if (line.kind === 'exec' || line.kind === 'break' || line.kind === 'label' || line.kind === 'reset') {
      out.push(line.argument ? `${line.command} ${line.argument}` : line.command);
      continue;
    }
    if (line.kind === 'commit') {
      out.push(`${line.command} ${line.hash} ${line.subject}`);
    }
  }
  return `${out.join('\n')}\n`;
}

export function commitLinesOnly(lines: readonly RebaseTodoLine[]): RebaseTodoCommitLine[] {
  return lines.filter((l): l is RebaseTodoCommitLine => l.kind === 'commit');
}
