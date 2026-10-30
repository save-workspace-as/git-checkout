import { isUncommittedSha } from '../../shared/history/blameProtocol';
import type { LineBlame } from './lineBlameFormat';
import type { FileBlame } from './lineBlameService';

const DAY = 24 * 3600;

/** How old a change is, as five steps from the newest (1) to the oldest (5); each has a color a theme can change. */
export const HEAT_STEPS = 5;
const HEAT_LIMITS = [7 * DAY, 30 * DAY, 180 * DAY, 365 * DAY];

export function heatStep(authorTime: number, nowMs: number): number {
  const age = nowMs / 1000 - authorTime;
  const index = HEAT_LIMITS.findIndex((limit) => age < limit);
  return index === -1 ? HEAT_STEPS : index + 1;
}

export interface GutterLine {
  /** 0-based, as the editor counts. */
  line: number;
  sha: string;
  heat: number;
  /** The text for the first line of a commit's run of lines; empty for the rest of the run. */
  text: string;
}

/** Narrow and wide ends of the annotation column, in characters. */
export const GUTTER_MIN = 16;
export const GUTTER_MAX = 40;

/**
 * What each line of a file shows in the gutter. A run of lines from one commit reads once, on its first line, and
 * the lines under it stay blank, so the column shows where each change begins. A line git has no blame for is left
 * out, which happens past the end of a file that changed under the blame.
 */
export function gutterLines(file: FileBlame, lineCount: number, describe: (blame: LineBlame) => string, nowMs: number): GutterLine[] {
  const lines: GutterLine[] = [];
  let previous: string | undefined;
  for (let line = 1; line <= lineCount; line++) {
    const blame = file.get(line);
    if (!blame) {
      previous = undefined;
      continue;
    }
    lines.push({
      line: line - 1,
      sha: blame.sha,
      heat: isUncommittedSha(blame.sha) ? 1 : heatStep(blame.authorTime, nowMs),
      text: blame.sha === previous ? '' : describe(blame),
    });
    previous = blame.sha;
  }
  return lines;
}

/** The column's width: the longest text, kept between the narrow and wide ends so one long name cannot take the screen. */
export function gutterWidth(lines: readonly GutterLine[]): number {
  const longest = lines.reduce((max, line) => Math.max(max, [...line.text].length), 0);
  return Math.min(GUTTER_MAX, Math.max(GUTTER_MIN, longest));
}

/** The text cut to `width` characters with an ellipsis, so every annotation fits the column. */
export function fitToWidth(text: string, width: number): string {
  const characters = [...text];
  return characters.length <= width ? text : `${characters.slice(0, width - 1).join('').trimEnd()}…`;
}

export interface RangeSummary {
  /** The newest change in the range; a line that is not committed counts as the newest. */
  recent?: LineBlame;
  /** Who wrote the committed lines, most lines first. */
  authors: { name: string; lines: number }[];
}

/** What the CodeLens above a file or a symbol says, from the blame of its lines (1-based, both ends included). */
export function summarizeRange(file: FileBlame, first: number, last: number): RangeSummary {
  let recent: LineBlame | undefined;
  const counts = new Map<string, number>();
  for (let line = first; line <= last; line++) {
    const blame = file.get(line);
    if (!blame) {
      continue;
    }
    const uncommitted = isUncommittedSha(blame.sha);
    if (!recent || (uncommitted && !isUncommittedSha(recent.sha)) || (!isUncommittedSha(recent.sha) && blame.authorTime > recent.authorTime)) {
      recent = blame;
    }
    if (!uncommitted) {
      counts.set(blame.author, (counts.get(blame.author) ?? 0) + 1);
    }
  }
  const authors = [...counts].map(([name, lines]) => ({ name, lines })).sort((a, b) => b.lines - a.lines || a.name.localeCompare(b.name));
  return { recent, authors };
}
