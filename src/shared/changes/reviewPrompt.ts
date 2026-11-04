/** Most characters of the staged diff sent to the model; the rest is cut so the request stays small. */
export const MAX_REVIEW_DIFF_CHARS = 40_000;

/** The instructions and the staged changes, as one prompt. */
export function buildReviewPrompt(diff: string): string {
  const shown = diff.length > MAX_REVIEW_DIFF_CHARS ? `${diff.slice(0, MAX_REVIEW_DIFF_CHARS)}\n[diff truncated]` : diff;
  return [
    'Review the staged changes below before they are committed.',
    '- Look for bugs, missing error handling, leftover debugging code, secrets or credentials, and changes that look unintended.',
    '- Name the file and the line or code for each finding, and say why it matters in one sentence.',
    '- List the most serious findings first. Skip style preferences and anything that is only a matter of taste.',
    '- Say only what the changes show; do not invent problems. When you find nothing worth raising, reply with exactly "No issues found."',
    '- Reply in Markdown, with no text before or after it.',
    '',
    'Staged changes:',
    shown,
  ].join('\n');
}
