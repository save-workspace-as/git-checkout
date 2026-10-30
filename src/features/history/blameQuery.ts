import type { BlameLine } from './gitBlameParser';
import type { BlameLineDto } from '../../shared/history/blameProtocol';

export function buildBlameArgs(revision: string, path: string, start: number, end: number, extra: readonly string[] = []): string[] {
  const args = ['blame', '--porcelain', ...extra, `-L${start},${end}`];
  if (revision) {
    args.push(revision);
  }
  args.push('--', path.replace(/\\/g, '/'));
  return args;
}

/** Consecutive runs of line numbers as `[first, last]` pairs, so blame reads only those lines. */
export function lineRanges(lines: readonly number[]): [number, number][] {
  const sorted = [...new Set(lines.filter((line) => Number.isInteger(line) && line > 0))].sort((a, b) => a - b);
  const ranges: [number, number][] = [];
  for (const line of sorted) {
    const last = ranges.at(-1);
    if (last && line === last[1] + 1) {
      last[1] = line;
    } else {
      ranges.push([line, line]);
    }
  }
  return ranges;
}

/** `git blame` of several line ranges at a revision in one call. */
export function buildBlameRangesArgs(revision: string, path: string, ranges: readonly [number, number][], extra: readonly string[] = []): string[] {
  return ['blame', '--porcelain', ...extra, ...ranges.map(([first, last]) => `-L${first},${last}`), revision, '--', path.replace(/\\/g, '/')];
}

/** Git's "file has only N lines" fatal, used to stop batched blame at EOF. */
export function blameEndLine(stderr: string): number | undefined {
  const match = /has only (\d+) lines/i.exec(stderr);
  if (!match) {
    return undefined;
  }
  const count = Number(match[1]);
  return Number.isInteger(count) ? count : undefined;
}

export function toBlameLineDtos(lines: readonly BlameLine[], previousSha?: string): BlameLineDto[] {
  return lines.map((line, index) => {
    const prior = index === 0 ? previousSha : lines[index - 1]?.sha;
    return {
      line: line.finalLine,
      text: line.text,
      sha: line.sha,
      author: line.author,
      authorMail: line.authorMail,
      authorTime: line.authorTime,
      summary: line.summary,
      groupStart: prior !== line.sha,
    };
  });
}
