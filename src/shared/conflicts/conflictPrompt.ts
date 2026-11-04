import { conflictsOf, parseMergeDocument } from './mergeDocument';

/** Most characters of one conflicted file (and its common ancestor) sent to the model; a larger file is left to the user. */
export const MAX_CONFLICT_CHARS = 120_000;

export interface ConflictPromptInput {
  path: string;
  /** The file as Git left it, with conflict markers. */
  text: string;
  /** The file the two sides started from, when Git has one. */
  base?: string;
  /** The branch or commit of each side, and the subject of its commit. */
  current: { label: string; subject: string };
  incoming: { label: string; subject: string };
}

/** Whether a file is small enough to send; the prompt includes the file and its common ancestor. */
export function fitsConflictPrompt(input: Pick<ConflictPromptInput, 'text' | 'base'>): boolean {
  return input.text.length + (input.base?.length ?? 0) <= MAX_CONFLICT_CHARS;
}

const describeSide = (side: { label: string; subject: string }): string =>
  [side.label, side.subject ? `"${side.subject}"` : ''].filter(Boolean).join(' ');

const withoutFinalEol = (text: string): string => text.replace(/\r?\n$/, '');

/** The instructions and one conflicted file, as one prompt. */
export function buildConflictPrompt({ path, text, base, current, incoming }: ConflictPromptInput): string {
  return [
    'Resolve the merge conflicts in the file below.',
    '- Keep the intent of both sides: combine their changes when they do not contradict each other.',
    '- When they do contradict, keep the behavior of the current side unless the incoming change clearly supersedes it.',
    '- Keep everything outside the conflicts exactly as it is, including indentation and line endings.',
    '- Remove every conflict marker (<<<<<<<, =======, >>>>>>>, and ||||||| lines).',
    '- Reply with the complete resolved file in one fenced code block, and nothing else: no commentary.',
    '',
    `File: ${path}`,
    `Current side (HEAD): ${describeSide(current) || 'unknown'}`,
    `Incoming side: ${describeSide(incoming) || 'unknown'}`,
    '',
    base === undefined ? '' : `Common ancestor of the two sides:\n\`\`\`\n${withoutFinalEol(base)}\n\`\`\`\n`,
    'File with conflict markers:',
    '```',
    withoutFinalEol(text),
    '```',
  ].join('\n');
}

export interface WholeFilePromptInput {
  path: string;
  /** The file the sides started from, when Git has one. */
  base?: string;
  /** The whole file of each side; a side that deleted the file has none. */
  current?: string;
  incoming?: string;
  currentSide: { label: string; subject: string };
  incomingSide: { label: string; subject: string };
}

/** Reply that stands for deleting the file, when a side deleted it. */
export const DELETE_ANSWER = 'DELETE';

export const isDeleteAnswer = (reply: string): boolean => reply.trim().replace(/^`+|`+$/g, '').trim() === DELETE_ANSWER;

/** Whether either side's text is too large to send, or the file is binary. */
export const isBinaryText = (...texts: (string | undefined)[]): boolean => texts.some((text) => text?.includes('\0'));

/**
 * The prompt for a conflict with no markers to work from: both sides changed the whole file, or one side deleted it
 * and the other changed it. The model merges the two versions, or says the deletion wins.
 */
export function buildWholeFilePrompt({ path, base, current, incoming, currentSide, incomingSide }: WholeFilePromptInput): string {
  const fence = (title: string, text: string | undefined): string =>
    text === undefined ? '' : `${title}:\n\`\`\`\n${withoutFinalEol(text)}\n\`\`\`\n`;
  const deleted = current === undefined ? 'The current side' : incoming === undefined ? 'The incoming side' : undefined;
  return [
    deleted
      ? `${deleted} deleted this file while the other side changed it. Decide whether the file should stay.`
      : 'Both sides changed this file in a way Git could not merge line by line. Merge the two versions.',
    deleted
      ? `- If the changes should be kept, reply with the complete file in one fenced code block.\n- If the deletion should win, reply with exactly ${DELETE_ANSWER} and nothing else.`
      : '- Keep the intent of both sides, and the behavior of the current side where they contradict.\n- Reply with the complete merged file in one fenced code block, and nothing else: no commentary.',
    '',
    `File: ${path}`,
    `Current side (HEAD): ${describeSide(currentSide) || 'unknown'}`,
    `Incoming side: ${describeSide(incomingSide) || 'unknown'}`,
    '',
    fence('Common ancestor', base),
    fence('Current side file', current),
    fence('Incoming side file', incoming),
  ].join('\n');
}

export type ParsedResolution = { ok: true; text: string } | { ok: false; reason: 'empty' | 'markers' };

/**
 * The resolved file from a model reply: the fenced block (or the whole reply when it has no fence), with the line
 * endings and final line break of the file it replaces. A reply that is empty, or still has conflict markers, is
 * refused, so a half-resolved file is never written.
 */
export function parseResolvedFile(reply: string, original: string): ParsedResolution {
  const trimmed = reply.trim();
  // The fence is the outermost one, after any lead-in: a file can hold fences of its own, such as a Markdown file.
  const fenced = /(?:^|\n)(`{3,}|~{3,})[^\n]*\n([\s\S]*)\n\1[ \t]*$/.exec(trimmed);
  let body = fenced ? fenced[2] : trimmed;
  if (body.trim() === '') {
    return { ok: false, reason: 'empty' };
  }
  body = body.replace(/\r\n/g, '\n');
  if (/^(<{7}|>{7})( |$)/m.test(body) || conflictsOf(parseMergeDocument(body)).length > 0) {
    return { ok: false, reason: 'markers' };
  }
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const finalEol = /\r?\n$/.test(original);
  body = body.replace(/\n+$/, '');
  return { ok: true, text: (eol === '\r\n' ? body.replace(/\n/g, '\r\n') : body) + (finalEol ? eol : '') };
}
