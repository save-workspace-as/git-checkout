import * as l10n from '@vscode/l10n';
import { segmentReferences, type AutolinkRule } from '../../shared/history/autolinks';
import type { GitHubRepository, GitHubTextSegment } from '../../shared/history/githubReferences';
import { isUncommittedSha } from '../../shared/history/blameProtocol';
import { relativeAge, type CommitInfo } from './lineBlameFormat';
import { roundPng } from './roundPng';
import { ACTION_ICONS } from '../../shared/app/actionIcons';

export const COPY_HASH_COMMAND = 'gitCheckout.blame.copyHash';
export const OPEN_COMMIT_COMMAND = 'gitCheckout.blame.openCommit';
export const LINE_HISTORY_COMMAND = 'gitCheckout.blame.lineHistory';
export const OPEN_CHANGES_COMMAND = 'gitCheckout.blame.openChanges';
export const OPEN_IN_BLAME_COMMAND = 'gitCheckout.blame.openInBlame';
export const BLAME_BEFORE_COMMAND = 'gitCheckout.blame.stepBack';

/** The commands a hover may run; the hover is trusted for these and no others. */
export const HOVER_COMMANDS = [COPY_HASH_COMMAND, OPEN_COMMIT_COMMAND, OPEN_CHANGES_COMMAND, OPEN_IN_BLAME_COMMAND, BLAME_BEFORE_COMMAND, LINE_HISTORY_COMMAND];

/** What a hover's commands act on. */
export interface BlameTarget {
  repoRoot: string;
  sha: string;
  /** The file and line the hover is for, as repository paths and 1-based numbers. */
  path: string;
  line: number;
  /** The file's path in the commit, which differs from `path` when the file was renamed since. */
  commitPath?: string;
  /** The line's number in the commit's version of the file, for stepping back from it. */
  originalLine?: number;
}

/** Markdown has meaning in a commit message; show the characters as they are. */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+!|<>~&]/g, '\\$&').replace(/^(\s*)-/gm, '$1\\-');
}

function commandLink(label: string, title: string, command: string, argument: unknown): string {
  return `[${label}](command:${command}?${encodeURIComponent(JSON.stringify([argument]))} "${title}")`;
}

function linked(text: string, repo: GitHubRepository | null, rules: readonly AutolinkRule[]): { markdown: string; references: Map<string, string> } {
  const references = new Map<string, string>();
  const markdown = segmentReferences(text, repo, rules)
    .map((segment: GitHubTextSegment) => {
      if (segment.kind === 'text') {
        return escapeMarkdown(segment.text);
      }
      references.set(segment.text, segment.url);
      return `[${escapeMarkdown(segment.text)}](${segment.url})`;
    })
    .join('');
  return { markdown, references };
}

function absoluteDate(seconds: number, locale?: string): string {
  return new Date(seconds * 1000).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

const SEPARATOR = '---';

/** "GitHub #12" for a GitHub reference; a tracker's own reference, such as `JIRA-123`, stands as it is. */
function referenceLabel(text: string, url: string, repo: GitHubRepository | null): string {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    // Every link here was built from a valid address; if not, it is shown as plain text.
  }
  return host === (repo?.host ?? 'github.com') ? l10n.t('GitHub {0}', escapeMarkdown(text)) : escapeMarkdown(text);
}
const AVATAR_SIZE = 32;

/** Who and when; the picture, when there is one, comes first on the same line. */
function header(commit: CommitInfo, picture: string | undefined, age: string, date: string): string {
  const image = picture ? `![](${picture}|width=${AVATAR_SIZE},height=${AVATAR_SIZE}) \u00a0` : '';
  return `${image}**${escapeMarkdown(commit.author)}** \u00a0$(history) ${escapeMarkdown(age)} *(${escapeMarkdown(date)})*`;
}

/**
 * The picture as a circle, like the round pictures of the graph and the details, as a PNG in a `data:` address. A
 * hover cannot round an image with CSS, and it drops an SVG that holds the picture, so the picture itself is cut.
 * Undefined for a picture that is not a PNG this can read; the hover then shows the address as it is.
 */
export function roundedAvatar(bytes: Uint8Array, mime: string): string | undefined {
  if (mime !== 'image/png') {
    return undefined;
  }
  const rounded = roundPng(bytes);
  return rounded ? `data:image/png;base64,${rounded.toString('base64')}` : undefined;
}

/**
 * The hover for a blamed line, in the order GitHub-minded readers expect: the author's picture, name and
 * when; the commit message with its issue and pull request references linked; one row per reference; and
 * the actions that work on the commit. The result is trusted Markdown with theme icons, so everything that
 * comes from a commit goes through `escapeMarkdown` first. `avatarUrl` must come from `roundedAvatar`, or be a GitHub picture address.
 */
export function blameHoverMarkdown(
  commit: CommitInfo,
  target: BlameTarget,
  repo: GitHubRepository | null,
  nowMs: number,
  locale?: string,
  avatarUrl?: string,
  autolinks: readonly AutolinkRule[] = [],
): string {
  if (isUncommittedSha(commit.sha)) {
    return l10n.t('**You**, uncommitted changes');
  }
  const [subject = '', ...body] = commit.message.split('\n');
  const subjectLinked = linked(subject, repo, autolinks);
  const bodyLinked = linked(body.join('\n').trim(), repo, autolinks);
  const references = new Map([...subjectLinked.references, ...bodyLinked.references]);
  const short = commit.sha.slice(0, 7);
  const picture = avatarUrl && /^(data:image\/png;base64,[A-Za-z0-9+/=]+|https:\/\/avatars\.githubusercontent\.com\/[A-Za-z0-9_\-./?=&%]+)$/.test(avatarUrl) ? avatarUrl : undefined;

  const blocks = [
    header(commit, picture, relativeAge(commit.authorTime, nowMs, locale), absoluteDate(commit.authorTime, locale)),
    [subjectLinked.markdown, bodyLinked.markdown].filter(Boolean).join('\n\n'),
  ];
  if (references.size > 0) {
    blocks.push(SEPARATOR, [...references].map(([text, url]) => `$(link) [${referenceLabel(text, url, repo)}](${url})`).join('  \n'));
  }

  const argument = { ...target, sha: commit.sha };
  const actions = [
    commandLink(`$(git-commit) ${short}`, l10n.t('Show Commit in Graph'), OPEN_COMMIT_COMMAND, argument),
    commandLink('$(copy)', l10n.t('Copy Commit Hash'), COPY_HASH_COMMAND, argument),
    commandLink(`$(${ACTION_ICONS.openDiff})`, l10n.t('Open Changes'), OPEN_CHANGES_COMMAND, argument),
    commandLink(`$(${ACTION_ICONS.openBlame})`, l10n.t('Show Blame at Commit'), OPEN_IN_BLAME_COMMAND, argument),
    commandLink(`$(${ACTION_ICONS.blameBefore})`, l10n.t('Blame Before This Change'), BLAME_BEFORE_COMMAND, argument),
    commandLink('$(history)', l10n.t('Show History of Line'), LINE_HISTORY_COMMAND, argument),
  ];
  if (repo) {
    actions.push(`[$(github)](https://${repo.host}/${repo.owner}/${repo.repo}/commit/${commit.sha} "${l10n.t('Open on GitHub')}")`);
  }
  blocks.push(SEPARATOR, actions.join(' \u00a0 '));
  return blocks.filter(Boolean).join('\n\n');
}
