/** A graph search split into the words to look for and the filters given as `key:value`. */
export interface GraphSearchQuery {
  text: string;
  author?: string;
  since?: string;
  until?: string;
  /** Commits that add or remove this text (`git log -S`). */
  content?: string;
  path?: string;
}

const FILTER_KEYS = ['author', 'since', 'until', 'content', 'path'] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

/**
 * Splits `author:ada path:src/app.ts since:2024-01-01 fix login` into filters and the remaining words.
 * A value with spaces is quoted: `author:"Ada Lovelace"`. An unknown `key:` stays part of the text.
 */
export function parseGraphSearchQuery(query: string): GraphSearchQuery {
  const result: GraphSearchQuery = { text: '' };
  const words: string[] = [];
  const token = /(\w+):(?:"([^"]*)"|(\S+))|\S+/g;
  for (const match of query.matchAll(token)) {
    const key = match[1]?.toLowerCase();
    const value = match[2] ?? match[3];
    if (key && value !== undefined && value !== '' && (FILTER_KEYS as readonly string[]).includes(key)) {
      result[key as FilterKey] = value;
    } else {
      words.push(match[0]);
    }
  }
  result.text = words.join(' ');
  return result;
}

/** The `git log` arguments that apply the filters, and the path to limit to, if any. */
export function graphSearchGitArgs(query: GraphSearchQuery): { args: string[]; path?: string } | undefined {
  const args: string[] = [];
  if (query.author) { args.push(`--author=${query.author}`); }
  if (query.since) { args.push(`--since=${query.since}`); }
  if (query.until) { args.push(`--until=${query.until}`); }
  if (query.content) { args.push(`-S${query.content}`); }
  if (args.length === 0 && !query.path) { return undefined; }
  return { args, ...(query.path ? { path: query.path } : {}) };
}
