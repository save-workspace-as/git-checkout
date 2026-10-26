import type { BlameLineDto } from './blameProtocol';
import { isUncommittedSha } from './blameProtocol';
import type { CommitDiffLineDto } from './commitDetailsProtocol';
import type { BlameCommitDto } from './pathHistoryProtocol';

export interface DiffBlame {
  /** One entry per diff line: the commit that last changed it, or an empty string for a hunk header or an unknown line. */
  shas: string[];
  commits: Record<string, BlameCommitDto>;
}

/**
 * Pairs each line of a commit's diff with the commit that last changed it. Added and unchanged lines
 * are looked up in the file as the commit left it; removed lines in the file as it was before.
 */
export function annotateDiffLines(
  lines: readonly CommitDiffLineDto[],
  after: readonly BlameLineDto[],
  before: readonly BlameLineDto[],
): DiffBlame {
  const byLine = (blame: readonly BlameLineDto[]) => new Map(blame.map((entry) => [entry.line, entry]));
  const afterByLine = byLine(after);
  const beforeByLine = byLine(before);
  const commits: Record<string, BlameCommitDto> = {};
  const shas = lines.map((line) => {
    if (line.kind === 'hunk' || line.line === undefined) { return ''; }
    const found = (line.kind === 'del' ? beforeByLine : afterByLine).get(line.line);
    if (!found || isUncommittedSha(found.sha)) { return ''; }
    commits[found.sha] ??= {
      author: found.author, authorMail: found.authorMail, authorTime: found.authorTime, summary: found.summary,
    };
    return found.sha;
  });
  return { shas, commits };
}
