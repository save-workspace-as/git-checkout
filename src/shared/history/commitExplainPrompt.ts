/** Most characters of the commit's diff sent to the model; the rest is cut so the request stays small. */
export const MAX_EXPLAIN_DIFF_CHARS = 24_000;

export interface CommitExplainInput {
  /** The commit message, subject and body. */
  message: string;
  /** `git show --patch-with-stat` of the commit, against its first parent. */
  diff: string;
}

/** The instructions, the commit message and the changes, as one prompt. */
export function buildExplainPrompt({ message, diff }: CommitExplainInput): string {
  const shown = diff.length > MAX_EXPLAIN_DIFF_CHARS ? `${diff.slice(0, MAX_EXPLAIN_DIFF_CHARS)}\n[diff truncated]` : diff;
  return [
    'Explain the Git commit below to a developer who has not seen this code before.',
    '- Start with a short summary of what the commit does and why, in one or two sentences.',
    '- Then list what changed, grouped by area or file, in a few Markdown bullets.',
    '- End with a "Worth checking" list only when the changes show a real risk, such as a changed public behavior, a removed check or a missing test.',
    '- Say only what the message and the changes show; do not guess at intent that they do not.',
    '- Reply in Markdown, with no text before or after it.',
    '',
    'Commit message:',
    message.trim(),
    '',
    'Changes:',
    shown,
  ].join('\n');
}
