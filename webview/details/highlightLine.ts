import hljs from 'highlight.js/lib/core';
import { languageByExtension, languageLoaders } from './languageLoaders';

const pending = new Map<string, Promise<void>>();

function extensionOf(filePath: string): string {
  const base = filePath.split('/').pop()?.toLowerCase() ?? '';
  if (base === 'dockerfile' || base === 'makefile') {
    return base;
  }
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1) : '';
}

/** Loads the highlight.js grammar for this file's extension, once. */
async function languageFor(filePath: string): Promise<string | undefined> {
  const name = languageByExtension[extensionOf(filePath)];
  const load = name ? languageLoaders[name] : undefined;
  if (!name || !load) {
    return undefined;
  }
  if (hljs.getLanguage(name)) {
    return name;
  }
  let task = pending.get(name);
  if (!task) {
    task = load().then((mod) => {
      hljs.registerLanguage(name, mod.default);
    });
    pending.set(name, task);
  }
  await task;
  return hljs.getLanguage(name) ? name : undefined;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightOne(language: string, line: string): string {
  if (line.length === 0) {
    return '';
  }
  return hljs.highlight(line, { language, ignoreIllegals: true }).value;
}

/** Prefer one block highlight for grammar state; fall back to per-line when line counts diverge. */
function highlightMany(language: string, lines: string[]): string[] {
  if (lines.length === 0) {
    return [];
  }
  if (lines.length === 1) {
    return [highlightOne(language, lines[0] ?? '')];
  }
  const html = hljs.highlight(lines.join('\n'), { language, ignoreIllegals: true }).value;
  // Each code row is a separate element; carry multiline scopes across row boundaries.
  const open: string[] = [];
  const parts = html.split('\n').map((part) => {
    const prefix = open.join('');
    for (const match of part.matchAll(/<span\b[^>]*>|<\/span>/g)) {
      if (match[0] === '</span>') {
        open.pop();
      } else {
        open.push(match[0]);
      }
    }
    return prefix + part + '</span>'.repeat(open.length);
  });
  if (parts.length === lines.length) {
    return parts;
  }
  return lines.map((line) => highlightOne(language, line));
}

/** Highlights diff lines after loading the grammar for the file extension. */
export async function highlightDiffLines(
  filePath: string,
  lines: { kind: string; text: string }[],
): Promise<string[]> {
  const plain = lines.map((line) => escapeHtml(line.text));
  const language = await languageFor(filePath);
  if (!language) {
    return plain;
  }
  const result = plain.slice();
  const sourceLines: string[] = [];
  const sourceIndexes: number[] = [];
  lines.forEach((line, index) => {
    if (line.kind === 'add' || line.kind === 'context') {
      sourceLines.push(line.text);
      sourceIndexes.push(index);
    }
  });
  if (sourceLines.length > 0) {
    const highlighted = highlightMany(language, sourceLines);
    sourceIndexes.forEach((index, offset) => {
      result[index] = highlighted[offset] ?? result[index] ?? '';
    });
  }
  lines.forEach((line, index) => {
    if (line.kind !== 'del') {
      return;
    }
    result[index] = highlightOne(language, line.text) || result[index] || '';
  });
  return result;
}
