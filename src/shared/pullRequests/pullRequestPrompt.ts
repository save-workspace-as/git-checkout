/** Most characters of the branch's diff sent to the model; the rest is cut so the request stays small. */
export const MAX_PULL_REQUEST_DIFF_CHARS = 24_000;

export interface PullRequestPromptInput {
  branch: string;
  base: string;
  /** The commits the branch has that the base does not, newest first. */
  commits: readonly { subject: string; body: string }[];
  /** `git diff --patch-with-stat` of the branch against its merge base. */
  diff: string;
}

/** The instructions, the commits and the changes of a branch, as one prompt. */
export function buildPullRequestPrompt({ branch, base, commits, diff }: PullRequestPromptInput): string {
  const shown = diff.length > MAX_PULL_REQUEST_DIFF_CHARS ? `${diff.slice(0, MAX_PULL_REQUEST_DIFF_CHARS)}\n[diff truncated]` : diff;
  return [
    `Write a GitHub pull request title and description for the branch "${branch}", to merge into "${base}".`,
    '- First line: the title, at most 72 characters, in the imperative mood, with no trailing period.',
    '- Then a blank line and the description in Markdown: a short summary of what changed and why, then a bullet list of the notable changes.',
    '- Follow the style of the commit subjects, such as any Conventional Commit prefix.',
    '- Do not invent test results, issue numbers or anything the commits and changes do not show.',
    '- Reply with the title and description only: no code fence around them, no commentary.',
    '',
    'Commits:',
    ...commits.map((commit) => `- ${commit.subject}${commit.body.trim() ? `\n${commit.body.trim().replace(/^/gm, '  ')}` : ''}`),
    '',
    'Changes:',
    shown,
  ].join('\n');
}

/** The title and the description from a model reply, without fences, quotes, headings or a "Title:" lead-in. */
export function parsePullRequestText(reply: string): { title: string; body: string } {
  let text = reply.trim();
  const fenced = /^(`{3,}|~{3,})[^\n]*\n([\s\S]*)\n\1\s*$/.exec(text);
  if (fenced) {
    text = fenced[2].trim();
  }
  const [first = '', ...rest] = text.split(/\r?\n/);
  const title = first
    .replace(/^#+\s*/, '')
    .replace(/^(?:pull request\s+)?title\s*:\s*/i, '')
    .replace(/^["'`*]+|["'`*]+$/g, '')
    .trim();
  const body = rest.join('\n').replace(/^\s*(?:#+\s*)?(?:description|body)\s*:?\s*\n/i, '').trim();
  return { title, body };
}

/**
 * VS Code opens a link with the characters of its query decoded, so `&`, `#` and `+` in a title or description would
 * start a new parameter, a fragment or a space. A text with none of them can travel in a link as it is.
 */
export const canTravelInLink = (text: string): boolean => !/[&#+]/.test(text);

/** A title that can travel in a link: the three characters are written out or dropped. */
export function linkableTitle(title: string): string {
  return title.replace(/&/g, 'and').replace(/#/g, '').replace(/\+/g, ' plus ').replace(/\s+/g, ' ').trim();
}
