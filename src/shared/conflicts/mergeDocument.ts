/**
 * A file with merge conflicts, as Git leaves it in the working tree: the text both sides agree on, and the
 * conflicts between `<<<<<<<` and `>>>>>>>`. The merge view shows the incoming side on the left and the
 * current side on the right, as VS Code's merge editor does.
 */
import { matchLines } from './lineMatch';

export interface MergeCommon {
  kind: 'common';
  lines: string[];
}

export interface MergeConflict {
  kind: 'conflict';
  /** The current side (Git's "ours"): the right side of the view. */
  current: string[];
  /** The incoming side (Git's "theirs"): the left side of the view. */
  incoming: string[];
  /** The common ancestor, when Git was asked for it (`merge.conflictStyle=diff3` or `zdiff3`). */
  base?: string[];
}

export type MergeSegment = MergeCommon | MergeConflict;

export interface MergeDocument {
  segments: MergeSegment[];
  eol: '\n' | '\r\n';
  /** The file ends with a line break. */
  finalEol: boolean;
}

/** What one side of a conflict gives the result. */
export interface SideChoice {
  /** The side counts as chosen. A side with no lines can only be chosen this way, to take nothing from it. */
  taken: boolean;
  /** Which of the side's lines go into the result. */
  lines: boolean[];
}

/** The lines each side of a conflict gives the result: nothing from either leaves it unresolved. */
export interface MergeChoice {
  incoming: SideChoice;
  current: SideChoice;
}

const START = /^<{7}(?: .*)?$/;
const BASE = /^\|{7}(?: .*)?$/;
const MIDDLE = /^={7}$/;
const END = /^>{7}(?: .*)?$/;

/** Splits the file into the text outside conflicts and the conflicts themselves. A broken marker stays as text. */
export function parseMergeDocument(text: string): MergeDocument {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const finalEol = text.endsWith('\n');
  const lines = text.split(/\r?\n/);
  if (finalEol) {
    lines.pop();
  }
  const segments: MergeSegment[] = [];
  const common = (line: string): void => {
    const last = segments[segments.length - 1];
    if (last?.kind === 'common') {
      last.lines.push(line);
    } else {
      segments.push({ kind: 'common', lines: [line] });
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const parsed = START.test(lines[i]) ? conflictAt(lines, i) : undefined;
    if (!parsed) {
      common(lines[i]);
      continue;
    }
    segments.push(parsed.conflict);
    i = parsed.end;
  }
  return { segments, eol, finalEol };
}

/** The conflict that starts at `start` and the index of its closing marker, or nothing when it is not closed. */
function conflictAt(lines: string[], start: number): { conflict: MergeConflict; end: number } | undefined {
  const current: string[] = [];
  const base: string[] = [];
  const incoming: string[] = [];
  let part: 'current' | 'base' | 'incoming' = 'current';
  let hasBase = false;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (part === 'current' && BASE.test(line)) {
      part = 'base';
      hasBase = true;
    } else if (part !== 'incoming' && MIDDLE.test(line)) {
      part = 'incoming';
    } else if (part === 'incoming' && END.test(line)) {
      return { conflict: { kind: 'conflict', current, incoming, ...(hasBase ? { base } : {}) }, end: i };
    } else if (START.test(line)) {
      return undefined;
    } else {
      (part === 'current' ? current : part === 'base' ? base : incoming).push(line);
    }
  }
  return undefined;
}

export function conflictsOf(document: MergeDocument): MergeConflict[] {
  return document.segments.filter((segment): segment is MergeConflict => segment.kind === 'conflict');
}

const sideOf = (lines: readonly string[], on: boolean): SideChoice => ({ taken: on, lines: lines.map(() => on) });

/** A conflict with nothing taken from either side. */
export const unresolved = (conflict: MergeConflict): MergeChoice => ({
  incoming: sideOf(conflict.incoming, false),
  current: sideOf(conflict.current, false),
});

export const isResolved = (choice: MergeChoice): boolean => choice.incoming.taken || choice.current.taken;

/** Takes a whole side of a conflict, or gives all of it back. */
export function withSideTaken(choice: MergeChoice, side: keyof MergeChoice, on: boolean): MergeChoice {
  return { ...choice, [side]: { taken: on, lines: choice[side].lines.map(() => on) } };
}

/** Takes one line of a side, or gives it back; the side counts as chosen while any of its lines is. */
export function withLineToggled(choice: MergeChoice, side: keyof MergeChoice, index: number): MergeChoice {
  const lines = choice[side].lines.map((taken, line) => (line === index ? !taken : taken));
  return { ...choice, [side]: { taken: lines.some(Boolean), lines } };
}

/** The lines a side gives the result, in their order. */
export const linesTaken = (choice: SideChoice, lines: readonly string[]): string[] =>
  choice.taken ? lines.filter((_, index) => choice.lines[index]) : [];

/**
 * The text the result editor starts from: the chosen lines, and for a conflict with no side chosen its markers,
 * as Git wrote them. Lines end with `\n`, as in a text area; `fileText` puts the file's own line breaks back.
 */
export function editableText(document: MergeDocument, choices: readonly MergeChoice[]): string {
  const lines: string[] = [];
  let index = -1;
  for (const segment of document.segments) {
    if (segment.kind === 'common') {
      lines.push(...segment.lines);
      continue;
    }
    index += 1;
    const choice = choices[index] ?? unresolved(segment);
    if (!isResolved(choice)) {
      lines.push('<<<<<<<', ...segment.current, '=======', ...segment.incoming, '>>>>>>>');
      continue;
    }
    lines.push(...linesTaken(choice.incoming, segment.incoming), ...linesTaken(choice.current, segment.current));
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}${document.finalEol ? '\n' : ''}`;
}

/** Text from the result editor as the file should hold it: with the file's own line breaks. */
export function fileText(document: MergeDocument, text: string): string {
  return document.eol === '\r\n' ? text.replace(/\r?\n/g, '\r\n') : text;
}

/** How many conflicts are still open in the text of the result editor. */
export function openConflicts(text: string): number {
  return conflictsOf(parseMergeDocument(text)).length;
}

/** A line of one side's pane, with its number in that side's file; a filler pads the side with fewer lines. */
export type PaneCell = {
  text: string;
  line: number;
  /** The line is not on the other side of its conflict: deleted on the left, added on the right. */
  changed?: boolean;
} | undefined;

/** The two sides as whole files, as Git has them in the index: the current side is "ours", the incoming one "theirs". */
export interface MergeSides {
  ours: string[];
  theirs: string[];
}

/** The place in the merged file a row stands for: a line of a common segment, or a row of a conflict. */
export interface RowAnchor {
  segment: number;
  offset: number;
}

export interface PaneRow {
  left: PaneCell;
  right: PaneCell;
  anchor: RowAnchor;
  /** The conflict this row belongs to, if any. */
  conflict?: number;
  /** The first row of its conflict, where the buttons go. */
  first?: boolean;
  /** The index of the row's line among the incoming lines of its conflict, and among the current ones. */
  incomingIndex?: number;
  currentIndex?: number;
}

/**
 * The two side panes row by row. With the whole files of both sides, each pane shows its file and a line that
 * only one side has sits on a row of its own, as in a diff. Without them, or when the files cannot be matched to
 * the merged file, the panes show the merged file twice, and the sides differ only inside the conflicts.
 */
export function paneRows(document: MergeDocument, sides?: MergeSides): PaneRow[] {
  return (sides && wholeFileRows(document, sides)) ?? mergedFileRows(document);
}

function mergedFileRows(document: MergeDocument): PaneRow[] {
  const rows: PaneRow[] = [];
  let leftLine = 0;
  let rightLine = 0;
  let index = -1;
  document.segments.forEach((segment, at) => {
    if (segment.kind === 'common') {
      segment.lines.forEach((text, offset) => {
        rows.push({ left: { text, line: ++leftLine }, right: { text, line: ++rightLine }, anchor: { segment: at, offset } });
      });
      return;
    }
    index += 1;
    alignConflict(segment).forEach(({ incoming, current }, i) => {
      const matched = incoming !== undefined && current !== undefined && segment.incoming[incoming] === segment.current[current];
      rows.push({
        left: incoming === undefined ? undefined : { text: segment.incoming[incoming], line: ++leftLine, ...(matched ? {} : { changed: true }) },
        right: current === undefined ? undefined : { text: segment.current[current], line: ++rightLine, ...(matched ? {} : { changed: true }) },
        anchor: { segment: at, offset: i },
        conflict: index,
        ...(incoming === undefined ? {} : { incomingIndex: incoming }),
        ...(current === undefined ? {} : { currentIndex: current }),
        ...(i === 0 ? { first: true } : {}),
      });
    });
  });
  return rows;
}

/** The rows of the two whole files, in the order of the merged file; nothing when they cannot be matched to it. */
function wholeFileRows(document: MergeDocument, sides: MergeSides): PaneRow[] | undefined {
  // What each side's file would be if the merged file were all there is to it: the conflicts hold that side's lines.
  const oursMerged: string[] = [];
  const theirsMerged: string[] = [];
  const oursAt: number[] = [];
  const theirsAt: number[] = [];
  for (const segment of document.segments) {
    oursAt.push(oursMerged.length);
    theirsAt.push(theirsMerged.length);
    oursMerged.push(...(segment.kind === 'common' ? segment.lines : segment.current));
    theirsMerged.push(...(segment.kind === 'common' ? segment.lines : segment.incoming));
  }
  const oursMatch = matchLines(oursMerged, sides.ours);
  const theirsMatch = matchLines(theirsMerged, sides.theirs);
  if (!oursMatch || !theirsMatch) {
    return undefined;
  }

  const rows: (Omit<PaneRow, 'anchor'> & { anchor?: RowAnchor })[] = [];
  let nextOurs = 0;
  let nextTheirs = 0;
  const cell = (lines: string[], index: number, changed: boolean): PaneCell =>
    ({ text: lines[index], line: index + 1, ...(changed ? { changed: true } : {}) });
  /** The lines of each file that are not in the merged file, up to where the next shared line is. */
  const flush = (oursEnd: number, theirsEnd: number): void => {
    const height = Math.max(oursEnd - nextOurs, theirsEnd - nextTheirs);
    for (let i = 0; i < height; i++) {
      rows.push({
        left: nextTheirs + i < theirsEnd ? cell(sides.theirs, nextTheirs + i, true) : undefined,
        right: nextOurs + i < oursEnd ? cell(sides.ours, nextOurs + i, true) : undefined,
      });
    }
    nextOurs = Math.max(nextOurs, oursEnd);
    nextTheirs = Math.max(nextTheirs, theirsEnd);
  };

  let conflict = -1;
  for (let at = 0; at < document.segments.length; at++) {
    const segment = document.segments[at];
    if (segment.kind === 'common') {
      for (let offset = 0; offset < segment.lines.length; offset++) {
        const ours = oursMatch[oursAt[at] + offset];
        const theirs = theirsMatch[theirsAt[at] + offset];
        if (ours === undefined && theirs === undefined) {
          return undefined;
        }
        flush(ours ?? nextOurs, theirs ?? nextTheirs);
        rows.push({
          left: theirs === undefined ? undefined : cell(sides.theirs, theirs, ours === undefined),
          right: ours === undefined ? undefined : cell(sides.ours, ours, theirs === undefined),
          anchor: { segment: at, offset },
        });
        nextOurs = ours === undefined ? nextOurs : ours + 1;
        nextTheirs = theirs === undefined ? nextTheirs : theirs + 1;
      }
      continue;
    }
    conflict += 1;
    const current = segment.current.map((_, i) => oursMatch[oursAt[at] + i]);
    const incoming = segment.incoming.map((_, i) => theirsMatch[theirsAt[at] + i]);
    if (current.includes(undefined) || incoming.includes(undefined)) {
      return undefined;
    }
    flush(current.length > 0 ? current[0]! : nextOurs, incoming.length > 0 ? incoming[0]! : nextTheirs);
    alignConflict(segment).forEach(({ incoming: left, current: right }, i) => {
      const matched = left !== undefined && right !== undefined && segment.incoming[left] === segment.current[right];
      rows.push({
        left: left === undefined ? undefined : cell(sides.theirs, incoming[left]!, !matched),
        right: right === undefined ? undefined : cell(sides.ours, current[right]!, !matched),
        anchor: { segment: at, offset: i },
        conflict,
        ...(left === undefined ? {} : { incomingIndex: left }),
        ...(right === undefined ? {} : { currentIndex: right }),
        ...(i === 0 ? { first: true } : {}),
      });
    });
    if (current.length > 0) { nextOurs = current[current.length - 1]! + 1; }
    if (incoming.length > 0) { nextTheirs = incoming[incoming.length - 1]! + 1; }
  }
  flush(sides.ours.length, sides.theirs.length);

  // The rows of lines that are not in the merged file stand where the next row of the merged file is.
  let anchor: RowAnchor | undefined;
  for (let i = rows.length - 1; i >= 0; i--) {
    anchor = rows[i].anchor ?? anchor;
    rows[i].anchor = anchor;
  }
  let previous: RowAnchor = { segment: 0, offset: 0 };
  return rows.map((row) => {
    previous = row.anchor ?? previous;
    return { ...row, anchor: previous };
  });
}

/**
 * The rows of a conflict, with the lines both sides share on the same row and the lines only one side has
 * next to each other in pairs, so the sides read like a diff. A side with no line on a row has a filler there.
 */
export function alignConflict(conflict: MergeConflict): { incoming?: number; current?: number }[] {
  const left = conflict.incoming;
  const right = conflict.current;
  const rows: { incoming?: number; current?: number }[] = [];
  const pairRun = (fromLeft: number, toLeft: number, fromRight: number, toRight: number): void => {
    const height = Math.max(toLeft - fromLeft, toRight - fromRight);
    for (let i = 0; i < height; i++) {
      rows.push({
        ...(fromLeft + i < toLeft ? { incoming: fromLeft + i } : {}),
        ...(fromRight + i < toRight ? { current: fromRight + i } : {}),
      });
    }
  };
  // A very large conflict is paired line by line rather than compared.
  if (left.length * right.length > 250_000) {
    pairRun(0, left.length, 0, right.length);
    return rows.length > 0 ? rows : [{}];
  }
  const width = right.length + 1;
  const table = new Uint32Array((left.length + 1) * width);
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      table[i * width + j] = left[i] === right[j]
        ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    let nextI = i;
    let nextJ = j;
    // Skip to the next line both sides have, if there is one.
    while (nextI < left.length && nextJ < right.length && left[nextI] !== right[nextJ]) {
      if (table[(nextI + 1) * width + nextJ] >= table[nextI * width + nextJ + 1]) { nextI++; } else { nextJ++; }
    }
    if (nextI >= left.length || nextJ >= right.length) {
      pairRun(i, left.length, j, right.length);
      break;
    }
    pairRun(i, nextI, j, nextJ);
    rows.push({ incoming: nextI, current: nextJ });
    i = nextI + 1;
    j = nextJ + 1;
  }
  return rows.length > 0 ? rows : [{}];
}

/**
 * For each row of `paneRows`, the line of `editableText` that shows the same place, so the panes and the result
 * can scroll together. A conflict's rows map to the lines its choice gives, the last line repeated when it has fewer.
 */
export function resultLineMap(document: MergeDocument, choices: readonly MergeChoice[], rows: readonly PaneRow[]): number[] {
  const starts: number[] = [];
  const lengths: number[] = [];
  let line = 0;
  let index = -1;
  for (const segment of document.segments) {
    starts.push(line);
    if (segment.kind === 'common') {
      lengths.push(segment.lines.length);
    } else {
      index += 1;
      const choice = choices[index] ?? unresolved(segment);
      lengths.push(isResolved(choice)
        ? linesTaken(choice.incoming, segment.incoming).length + linesTaken(choice.current, segment.current).length
        : segment.current.length + segment.incoming.length + 3);
    }
    line += lengths[lengths.length - 1];
  }
  return rows.map(({ anchor }) => {
    const at = anchor.segment;
    return starts[at] + Math.min(anchor.offset, Math.max(lengths[at] - 1, 0));
  });
}

/** Where a line of `editableText` came from: outside the conflicts, a side's line, or a conflict still open. */
export type LineOrigin = 'common' | 'incoming' | 'current' | 'open';

/** The origin of every line of `editableText`, in order. */
export function resultOrigins(document: MergeDocument, choices: readonly MergeChoice[]): LineOrigin[] {
  const origins: LineOrigin[] = [];
  let index = -1;
  for (const segment of document.segments) {
    if (segment.kind === 'common') {
      origins.push(...segment.lines.map((): LineOrigin => 'common'));
      continue;
    }
    index += 1;
    const choice = choices[index] ?? unresolved(segment);
    if (!isResolved(choice)) {
      origins.push(...Array.from({ length: segment.current.length + segment.incoming.length + 3 }, (): LineOrigin => 'open'));
      continue;
    }
    origins.push(
      ...linesTaken(choice.incoming, segment.incoming).map((): LineOrigin => 'incoming'),
      ...linesTaken(choice.current, segment.current).map((): LineOrigin => 'current'),
    );
  }
  return origins;
}

/** Takes a whole side of every conflict, as the checkboxes over the panes do, or gives it all back. */
export function withSide(choices: readonly MergeChoice[], side: keyof MergeChoice, on: boolean): MergeChoice[] {
  return choices.map((choice) => withSideTaken(choice, side, on));
}

/** Whether every line of this side is taken in every conflict: a checkbox over the panes is checked. */
export function allHaveSide(choices: readonly MergeChoice[], side: keyof MergeChoice): boolean {
  return choices.length > 0 && choices.every((choice) => choice[side].taken && choice[side].lines.every(Boolean));
}
