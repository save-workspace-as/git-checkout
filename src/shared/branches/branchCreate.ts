export const BRANCH_NAME_SEPARATORS = ['/', '-', '_'] as const;

export type BranchNameSeparator = (typeof BRANCH_NAME_SEPARATORS)[number];

export type BranchLocalChanges = 'keep' | 'stash' | 'discard';

export interface BranchCreateRequest {
  name: string;
  startPoint?: string;
  checkout: boolean;
  localChanges: BranchLocalChanges;
}

export interface BranchNamePrefill {
  currentBranch?: string | null;
  separator?: BranchNameSeparator;
}

/** The character VS Code's `git.branchWhitespaceChar` names; anything unusable falls back to a hyphen. */
export function parseBranchWhitespaceReplacement(value: unknown): string {
  return typeof value === 'string' && !/\s/.test(value) && !value.includes('..') ? value : '-';
}

/** A branch name with every run of whitespace character replaced, as typing it would have. */
export function replaceBranchWhitespace(name: string, replacement: string): string {
  return name.replace(/\s/g, replacement);
}

export function parseBranchNameSeparator(value: unknown): BranchNameSeparator {
  if (typeof value !== 'string') {
    return '/';
  }
  const trimmed = value.trim();
  if (trimmed === '/' || trimmed === '-' || trimmed === '_') {
    return trimmed;
  }
  return '/';
}

export function branchNamePrefix(
  currentBranch: string | null | undefined,
  separator: BranchNameSeparator,
): string {
  const name = currentBranch?.trim() ?? '';
  if (!name || name === 'HEAD') {
    return '';
  }
  const index = name.lastIndexOf(separator);
  if (index < 0) {
    return '';
  }
  return name.slice(0, index + separator.length);
}

export function branchNameInput(
  currentBranch: string | null | undefined,
  separator: BranchNameSeparator,
): { value: string; valueSelection: [number, number] } {
  const value = branchNamePrefix(currentBranch, separator);
  const cursor = value.length;
  return { value, valueSelection: [cursor, cursor] };
}

export function branchNameInputFrom(
  prefill?: BranchNamePrefill,
): { value: string; valueSelection: [number, number] } {
  return branchNameInput(prefill?.currentBranch, prefill?.separator ?? '/');
}
