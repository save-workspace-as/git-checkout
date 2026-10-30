import * as l10n from '@vscode/l10n';
import { isUncommittedSha } from '../../shared/history/blameProtocol';

/** What blame knows about one line of a file. */
export interface LineBlame {
  sha: string;
  author: string;
  authorMail: string;
  /** Seconds since the epoch. */
  authorTime: number;
  summary: string;
  /** The file's path in that commit, which differs from today's when the file was renamed since. */
  path?: string;
}

/** A commit as the hover shows it. */
export interface CommitInfo {
  sha: string;
  author: string;
  authorMail: string;
  authorTime: number;
  /** The whole commit message, subject first. */
  message: string;
}

export const DEFAULT_BLAME_FORMAT = '{author}, {date} \u2022 {summary}';

const MAX_SUMMARY = 80;

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** "3 days ago", in the language of VS Code. Times within a minute read as the unit's "now". */
export function relativeAge(seconds: number, nowMs: number, locale?: string): string {
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const elapsed = Math.max(0, Math.floor(nowMs / 1000 - seconds));
  for (const [unit, size] of UNITS) {
    if (elapsed >= size) {
      return format.format(-Math.floor(elapsed / size), unit);
    }
  }
  return format.format(0, 'minute');
}

function shorten(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}\u2026` : text;
}

/**
 * The text at the end of a line, from a template with `{author}`, `{date}` (3 days ago), `{datetime}` (the day and time), `{summary}` and `{hash}`.
 * A line that is not committed says so instead.
 */
export function formatLineBlame(template: string, blame: LineBlame, nowMs: number, locale?: string): string {
  if (isUncommittedSha(blame.sha)) {
    return l10n.t('You, uncommitted changes');
  }
  const values: Record<string, string> = {
    author: blame.author,
    date: relativeAge(blame.authorTime, nowMs, locale),
    datetime: new Date(blame.authorTime * 1000).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    summary: shorten(blame.summary, MAX_SUMMARY),
    hash: blame.sha.slice(0, 7),
  };
  return (template || DEFAULT_BLAME_FORMAT).replace(/\{(author|datetime|date|summary|hash)\}/g, (_match, key: string) => values[key] ?? '');
}

/** Reads `git show -s --format=%H%x00%an%x00%ae%x00%at%x00%B`. */
export function parseCommitInfo(output: string): CommitInfo | undefined {
  const [sha, author, authorMail, time, ...rest] = output.split('\0');
  if (!sha || !/^[0-9a-f]{4,64}$/i.test(sha.trim()) || rest.length === 0) {
    return undefined;
  }
  return {
    sha: sha.trim(),
    author: author ?? '',
    authorMail: authorMail ?? '',
    authorTime: Number.parseInt(time ?? '', 10) || 0,
    message: rest.join('\0').trim(),
  };
}
