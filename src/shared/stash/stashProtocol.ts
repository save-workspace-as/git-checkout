import type { WorkingCopyDiffSide } from '../changes/workingCopyProtocol';

export interface StashEntryDto {
  /** `stash@{n}` index, newest first in a list. */
  index: number;
  selector: string;
  sha: string;
  message: string;
}

export type StashCreateRequest =
  | { mode: 'all'; message: string; includeUntracked: boolean }
  | { mode: 'paths'; message: string; paths: string[] }
  | { mode: 'patch'; message: string; patch: string; side: WorkingCopyDiffSide };

const STASH_SELECTOR = /^stash@\{(\d+)\}$/;

export function isStashSelector(value: string): boolean {
  return STASH_SELECTOR.test(value);
}

export function assertStashSelector(value: string): string {
  if (!isStashSelector(value)) {
    throw new Error(`Invalid stash selector: ${value}`);
  }
  return value;
}

export function stashIndex(selector: string): number {
  const match = STASH_SELECTOR.exec(selector);
  if (!match) {
    throw new Error(`Invalid stash selector: ${selector}`);
  }
  return Number(match[1]);
}

/** Drop higher indexes first so earlier selectors stay valid. */
export function stashDropOrder(selectors: readonly string[]): string[] {
  return [...new Set(selectors.map(assertStashSelector))].sort((a, b) => stashIndex(b) - stashIndex(a));
}

export type StashWebviewMessage =
  | { type: 'stashApply'; selector: string }
  | { type: 'stashPop'; selector: string }
  | { type: 'stashDrop'; selector: string }
  | { type: 'stashWorkingCopyPath'; path: string };
