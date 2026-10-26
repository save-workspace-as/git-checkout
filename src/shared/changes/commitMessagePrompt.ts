import { splitCommitMessage } from './changesProtocol';

/** Most characters of the staged diff sent to the model; the rest is cut so the request stays small. */
export const MAX_DIFF_CHARS = 24_000;

export interface CommitPromptInput {
  /** `git diff --cached --patch-with-stat` output. */
  diff: string;
  /** Recent subjects of the repository, to match its style. */
  recentSubjects: readonly string[];
}

/** The instructions and the staged changes, as one prompt. */
export function buildCommitPrompt({ diff, recentSubjects }: CommitPromptInput): string {
  const truncated = diff.length > MAX_DIFF_CHARS;
  const shownDiff = truncated ? `${diff.slice(0, MAX_DIFF_CHARS)}\n[diff truncated]` : diff;
  return [
    'Write a git commit message for the staged changes below.',
    '- First line: a subject of at most 72 characters in the imperative mood, with no trailing period.',
    '- If the change needs explanation, add a blank line and a short body that says why, not what.',
    '- Follow the style of the recent commit subjects, such as any Conventional Commit prefix.',
    '- Reply with the commit message only: no quotes, no code fences, no commentary.',
    '',
    recentSubjects.length > 0 ? `Recent commit subjects:\n${recentSubjects.map((subject) => `- ${subject}`).join('\n')}` : '',
    '',
    'Staged changes:',
    shownDiff,
  ].join('\n');
}

/** The subject and description from a model reply, without fences, quotes or a "commit message:" lead-in. */
export function parseGeneratedMessage(reply: string): { subject: string; description: string } {
  let text = reply.trim();
  const fenced = /^```[\w-]*\n([\s\S]*?)\n?```$/.exec(text);
  if (fenced) {
    text = fenced[1].trim();
  }
  text = text.replace(/^(?:commit message|message)\s*:\s*/i, '');
  const parts = splitCommitMessage(text);
  const unquote = (value: string): string => value.replace(/^["'`]+|["'`]+$/g, '').trim();
  return { subject: unquote(parts.subject), description: parts.description };
}
