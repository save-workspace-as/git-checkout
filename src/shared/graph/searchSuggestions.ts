import * as l10n from '@vscode/l10n';

/** A filter the search understands, and what typing it looks like. */
interface FilterInfo {
  key: 'author' | 'path' | 'since' | 'until' | 'content' | 'regex';
  icon: string;
  describe(): string;
}

const FILTERS: readonly FilterInfo[] = [
  { key: 'author', icon: 'person', describe: () => l10n.t('Commits by an author') },
  { key: 'path', icon: 'file', describe: () => l10n.t('Commits that touch a file or folder') },
  { key: 'since', icon: 'calendar', describe: () => l10n.t('Commits after a date') },
  { key: 'until', icon: 'calendar', describe: () => l10n.t('Commits before a date') },
  { key: 'content', icon: 'search', describe: () => l10n.t('Commits that add or remove this text') },
  { key: 'regex', icon: 'regex', describe: () => l10n.t('Commits with a changed line that matches a pattern') },
];

export interface SearchSuggestion {
  /** What the list shows. */
  label: string;
  description?: string;
  icon: string;
  /** What replaces the word being typed. */
  insert: string;
  /** A filter name, which is followed by its value, or a value, which ends the word. */
  kind: 'key' | 'value';
}

export interface SearchSuggestions {
  /** The part of the text the suggestions replace. */
  start: number;
  end: number;
  items: SearchSuggestion[];
}

export interface SuggestionContext {
  /** Names of the authors of the commits that are loaded, most recent first. */
  authors?: readonly string[];
  /** Today's date as `YYYY-MM-DD`, for the date a person can start from. */
  today?: string;
  /** Show every filter even when nothing is typed yet. */
  force?: boolean;
  /** The most suggestions to give. */
  limit?: number;
}

const WORD = /(\w+):(?:"[^"]*"?|\S*)|\S+/g;
const RELATIVE_DATES = ['yesterday', '1 week ago', '1 month ago', '3 months ago', '1 year ago'];

/** A value with a space in it is quoted, as the search expects. */
export const quoteFilterValue = (value: string): string => (/\s/.test(value) ? `"${value}"` : value);

/**
 * The filters and values to offer for the word at the caret: filter names for a word that starts like one
 * (`pa` offers `path:`), and values once a name and its colon are typed (`since:` offers dates).
 */
export function suggestSearch(text: string, caret: number, context: SuggestionContext = {}): SearchSuggestions | undefined {
  const limit = context.limit ?? 8;
  let start = caret;
  let end = caret;
  for (const match of text.matchAll(WORD)) {
    const from = match.index;
    const to = from + match[0].length;
    if (from <= caret && caret <= to) {
      start = from;
      end = to;
      break;
    }
  }
  const word = text.slice(start, end);
  const used = new Set([...text.slice(0, start).matchAll(WORD), ...text.slice(end).matchAll(WORD)].map((match) => match[1]?.toLowerCase()));

  const colon = word.indexOf(':');
  if (colon < 0) {
    const typed = word.toLowerCase();
    if (typed === '' && !context.force) {
      return undefined;
    }
    const items = FILTERS
      .filter((filter) => filter.key.startsWith(typed) && !used.has(filter.key))
      // Typing a whole name offers nothing new; the colon does.
      .filter((filter) => filter.key !== typed)
      .slice(0, limit)
      .map((filter): SearchSuggestion => ({ label: `${filter.key}:`, description: filter.describe(), icon: filter.icon, insert: `${filter.key}:`, kind: 'key' }));
    return items.length > 0 ? { start, end, items } : undefined;
  }

  const key = word.slice(0, colon).toLowerCase();
  const typed = word.slice(colon + 1).replace(/^"/, '').replace(/"$/, '').toLowerCase();
  const filter = FILTERS.find((candidate) => candidate.key === key);
  if (!filter) {
    return undefined;
  }
  const value = (label: string, description?: string): SearchSuggestion => ({
    label, ...(description ? { description } : {}), icon: filter.icon, insert: `${key}:${quoteFilterValue(label)} `, kind: 'value',
  });
  let items: SearchSuggestion[] = [];
  if (key === 'author') {
    items = [...new Set(context.authors ?? [])].filter((name) => name.toLowerCase().includes(typed)).slice(0, limit).map((name) => value(name));
  } else if (key === 'since' || key === 'until') {
    items = RELATIVE_DATES.filter((date) => date.startsWith(typed)).map((date) => value(date));
    if (context.today && context.today.startsWith(typed)) {
      items.push(value(context.today, l10n.t('Today')));
    }
  }
  items = items.filter((item) => item.insert.trimEnd() !== word);
  return items.length > 0 ? { start, end, items: items.slice(0, limit) } : undefined;
}

/** The text with the suggestion in place of the word it replaces, and where the caret goes. */
export function applySuggestion(text: string, suggestions: SearchSuggestions, item: SearchSuggestion): { text: string; caret: number } {
  const before = text.slice(0, suggestions.start);
  const after = text.slice(suggestions.end).replace(/^\s+/, '');
  const next = `${before}${item.insert}${after}`;
  return { text: next, caret: before.length + item.insert.length };
}
