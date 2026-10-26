import { readdirSync } from 'node:fs';
import { join } from 'node:path';

export type NodeTestKind = 'unit' | 'integration';

export function isNodeTestFile(fileName: string, kind: NodeTestKind): boolean {
  if (!fileName.endsWith('.test.ts')) {
    return false;
  }
  const integration = fileName.endsWith('.integration.test.ts');
  return kind === 'integration' ? integration : !integration;
}

/** Paths are relative to `root` and sorted so the runner is stable. */
export function listNodeTestFiles(root: string, kind: NodeTestKind): string[] {
  const found: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (isNodeTestFile(entry.name, kind)) {
        found.push(path);
      }
    }
  }
  walk(root);
  found.sort();
  return found;
}

export interface TestArgs {
  /** Substrings that select test files. */
  filters: string[];
  /** Flags (and their values) forwarded to the underlying runner. */
  flags: string[];
}

/**
 * Splits CLI arguments into file filters and runner flags. A flag listed in
 * `valueFlags` and written without `=` consumes the next argument as its value.
 */
export function splitTestArgs(argv: readonly string[], valueFlags: ReadonlySet<string>): TestArgs {
  const filters: string[] = [];
  const flags: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('-')) {
      filters.push(arg);
      continue;
    }
    flags.push(arg);
    if (!arg.includes('=') && valueFlags.has(arg) && index + 1 < argv.length) {
      index += 1;
      flags.push(argv[index]);
    }
  }
  return { filters, flags };
}

/** Keeps files whose path contains any filter. With no filters, keeps every file. */
export function filterTestFiles(files: readonly string[], filters: readonly string[]): string[] {
  return filters.length === 0 ? [...files] : files.filter((file) => filters.some((filter) => file.includes(filter)));
}
