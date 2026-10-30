import { segmentGitHubReferences, type GitHubRepository, type GitHubTextSegment } from './githubReferences';

/** What the number in an autolink URL stands for, as GitLens writes it. */
export const AUTOLINK_NUMBER = '<num>';

/**
 * A tracker's references made links: text like `JIRA-123` becomes `url` with `<num>` replaced by `123`.
 * The settings use the same names as GitLens's `autolinks`, so those entries can be copied over.
 */
export interface AutolinkRule {
  prefix: string;
  url: string;
  ignoreCase: boolean;
  /** The part after the prefix may hold letters as well as digits. */
  alphanumeric: boolean;
}

const MAX_RULES = 50;
const MAX_PREFIX = 40;

function sampleUrl(url: string): URL | undefined {
  try {
    const parsed = new URL(url.split(AUTOLINK_NUMBER).join('1'));
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && !parsed.username && !parsed.password ? parsed : undefined;
  } catch {
    // Not an address; the rule is left out by the caller.
    return undefined;
  }
}

/** The rules a setting holds, without the entries that cannot work: no prefix, no `<num>`, or a URL that is not http(s). */
export function parseAutolinkRules(value: unknown): AutolinkRule[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const rules: AutolinkRule[] = [];
  for (const entry of value) {
    const item = entry as Partial<Record<keyof AutolinkRule, unknown>> | null;
    if (!item || typeof item.prefix !== 'string' || typeof item.url !== 'string') {
      continue;
    }
    const prefix = item.prefix.trim();
    if (!prefix || prefix.length > MAX_PREFIX || !item.url.includes(AUTOLINK_NUMBER) || !sampleUrl(item.url)) {
      continue;
    }
    rules.push({ prefix, url: item.url, ignoreCase: item.ignoreCase === true, alphanumeric: item.alphanumeric === true });
    if (rules.length >= MAX_RULES) {
      break;
    }
  }
  return rules;
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function split(text: string, rule: AutolinkRule): GitHubTextSegment[] {
  const number = rule.alphanumeric ? '[A-Za-z0-9]+' : '\\d+';
  const pattern = new RegExp(`(?<![A-Za-z0-9_])(${escapeRegExp(rule.prefix)}(${number}))(?![A-Za-z0-9_])`, rule.ignoreCase ? 'gi' : 'g');
  const segments: GitHubTextSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      segments.push({ kind: 'text', text: text.slice(cursor, index) });
    }
    segments.push({ kind: 'link', text: match[1], url: rule.url.split(AUTOLINK_NUMBER).join(encodeURIComponent(match[2])) });
    cursor = index + match[1].length;
  }
  if (cursor < text.length) {
    segments.push({ kind: 'text', text: text.slice(cursor) });
  }
  return segments;
}

/** GitHub references first, then each rule over the text that is left, so nothing is linked twice. */
export function segmentReferences(text: string, repo: GitHubRepository | null, rules: readonly AutolinkRule[]): GitHubTextSegment[] {
  let segments = segmentGitHubReferences(text, repo);
  for (const rule of rules) {
    segments = segments.flatMap((segment) => (segment.kind === 'text' ? split(segment.text, rule) : [segment]));
  }
  return segments;
}

/** Whether `url` is on a site one of the rules sends to, so a link a webview asks to open is one the user set up. */
export function isAutolinkUrl(url: string, rules: readonly AutolinkRule[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Not an address, so not one of ours.
    return false;
  }
  if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || parsed.username || parsed.password) {
    return false;
  }
  return rules.some((rule) => sampleUrl(rule.url)?.origin === parsed.origin);
}

/** The rules for a webview, as the value of a `data-autolinks` attribute on its `<body>`. */
export function autolinksBodyAttribute(rules: readonly AutolinkRule[]): string {
  if (rules.length === 0) {
    return '';
  }
  const json = JSON.stringify(rules).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return ` data-autolinks="${json}"`;
}

/** Reads what `autolinksBodyAttribute` wrote; anything else is no rules. */
export function parseAutolinksAttribute(value: string | undefined): AutolinkRule[] {
  if (!value) {
    return [];
  }
  try {
    return parseAutolinkRules(JSON.parse(value));
  } catch {
    // A value that does not parse means no rules; the webview shows plain text.
    return [];
  }
}
