import { GRAPH_COLOR_COUNT } from './graphLanes';

export function authorInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return '?';
  }
  const first = [...words[0]][0] ?? '';
  const last = words.length > 1 ? ([...words[words.length - 1]][0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** Stable colour slot for an author, so the same person keeps one colour. */
export function authorColor(email: string): number {
  let hash = 0;
  for (const ch of email.trim().toLowerCase()) {
    hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash % GRAPH_COLOR_COUNT;
}
