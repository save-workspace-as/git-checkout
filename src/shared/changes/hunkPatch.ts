import type { CommitDiffLineDto } from '../history/commitDetailsProtocol';

/** How many hunks the diff lines hold. */
export function hunkCount(lines: readonly CommitDiffLineDto[]): number {
  return lines.filter((line) => line.kind === 'hunk').length;
}

/**
 * A patch for one hunk of the diff on screen, so it applies whatever context or whitespace options
 * produced those lines. A hunk that creates or deletes the whole file gets a matching header.
 */
export function buildHunkPatch(
  path: string,
  lines: readonly CommitDiffLineDto[],
  hunkIndex: number,
): string | null {
  let index = -1;
  const body: string[] = [];
  let header = '';
  for (const line of lines) {
    if (line.kind === 'hunk') {
      index += 1;
      if (index === hunkIndex) {
        header = line.text;
      } else if (index > hunkIndex) {
        break;
      }
      continue;
    }
    if (index !== hunkIndex) {
      continue;
    }
    body.push(`${line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}${line.text}`);
    if (line.noEol) {
      body.push('\\ No newline at end of file');
    }
  }
  if (!header) {
    return null;
  }
  const creates = /^@@ -0,0 /.test(header);
  const deletes = / \+0,0 @@/.test(header);
  const head = [
    `diff --git a/${path} b/${path}`,
    ...(creates ? ['new file mode 100644'] : []),
    ...(deletes ? ['deleted file mode 100644'] : []),
    `--- ${creates ? '/dev/null' : `a/${path}`}`,
    `+++ ${deletes ? '/dev/null' : `b/${path}`}`,
  ];
  return `${[...head, header, ...body].join('\n')}\n`;
}

/** What a patch of selected lines does with the change it was made from. */
export type SelectionPatchOp = 'stage' | 'unstage' | 'discard';

interface HunkHeader { oldStart: number; oldCount: number; newStart: number; newCount: number; rest: string }

function parseHunkHeader(text: string): HunkHeader | null {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(text);
  return match
    ? { oldStart: Number(match[1]), oldCount: Number(match[2] ?? 1), newStart: Number(match[3]), newCount: Number(match[4] ?? 1), rest: match[5] }
    : null;
}

/** A hunk header's start counts from the line before when the side is empty. */
const firstLine = (start: number, count: number): number => (count === 0 ? start + 1 : start);
const headerStart = (first: number, count: number): number => (count === 0 ? first - 1 : first);

/**
 * A patch for only the selected change lines of the diff on screen. `stage` applies it to the index; `unstage`
 * and `discard` apply it in reverse, to the index and to the working tree.
 *
 * The lines that are not selected stay as they are on the side the patch is applied to: a change left out
 * becomes context where the patch would otherwise undo it, and is dropped where it is not there to undo.
 * That is the patch `git add -p` makes when the lines are edited.
 */
export function buildSelectionPatch(
  path: string,
  lines: readonly CommitDiffLineDto[],
  selected: ReadonlySet<number>,
  op: SelectionPatchOp,
): string | null {
  const reverse = op !== 'stage';
  const hunks: { header: HunkHeader; text: string; body: string[]; oldCount: number; newCount: number; picked: boolean }[] = [];
  let current: (typeof hunks)[number] | undefined;
  lines.forEach((line, position) => {
    if (line.kind === 'hunk') {
      const header = parseHunkHeader(line.text);
      current = header ? { header, text: line.text, body: [], oldCount: 0, newCount: 0, picked: false } : undefined;
      if (current) { hunks.push(current); }
      return;
    }
    if (!current) { return; }
    const picked = selected.has(position);
    let mark: ' ' | '+' | '-' | undefined;
    if (line.kind === 'context') {
      mark = ' ';
    } else if (line.kind === 'add') {
      mark = picked ? '+' : reverse ? ' ' : undefined;
    } else {
      mark = picked ? '-' : reverse ? undefined : ' ';
    }
    if (picked && (line.kind === 'add' || line.kind === 'del')) { current.picked = true; }
    if (mark === undefined) { return; }
    current.body.push(`${mark}${line.text}`);
    if (mark !== '+') { current.oldCount += 1; }
    if (mark !== '-') { current.newCount += 1; }
    if (line.noEol) { current.body.push('\\ No newline at end of file'); }
  });
  const emitted = hunks.filter((hunk) => hunk.picked);
  if (emitted.length === 0) {
    return null;
  }
  // Where each hunk starts moves with the hunks before it that changed the number of lines.
  let shift = 0;
  const parts: string[] = [];
  let creates = false;
  let deletes = false;
  for (const hunk of emitted) {
    const { header } = hunk;
    const oldFirst = reverse ? firstLine(header.newStart, header.newCount) - shift : firstLine(header.oldStart, header.oldCount);
    const newFirst = reverse ? firstLine(header.newStart, header.newCount) : firstLine(header.oldStart, header.oldCount) + shift;
    const oldStart = headerStart(oldFirst, hunk.oldCount);
    const newStart = headerStart(newFirst, hunk.newCount);
    const old = hunk.oldCount === 1 ? `${oldStart}` : `${oldStart},${hunk.oldCount}`;
    const next = hunk.newCount === 1 ? `${newStart}` : `${newStart},${hunk.newCount}`;
    parts.push(`@@ -${old} +${next} @@${header.rest}`, ...hunk.body);
    shift += hunk.newCount - hunk.oldCount;
    creates = creates || (hunk.oldCount === 0 && /^@@ -0,0 /.test(hunk.text));
    deletes = deletes || (hunk.newCount === 0 && / \+0,0 @@/.test(hunk.text));
  }
  const head = [
    `diff --git a/${path} b/${path}`,
    ...(creates ? ['new file mode 100644'] : []),
    ...(deletes ? ['deleted file mode 100644'] : []),
    `--- ${creates ? '/dev/null' : `a/${path}`}`,
    `+++ ${deletes ? '/dev/null' : `b/${path}`}`,
  ];
  return `${[...head, ...parts].join('\n')}\n`;
}
