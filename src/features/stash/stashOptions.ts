import * as l10n from '@vscode/l10n';
import type { StashCreateRequest } from '../../shared/stash/stashProtocol';

/** Options for stashing the whole working tree. */
export interface StashAllOptions {
  message: string;
  /** When false, newly created untracked files stay in the working tree. */
  includeNewFiles: boolean;
}

export type StashCreateArg =
  | { status: 'absent' }
  | { status: 'invalid'; message: string }
  | { status: 'ready'; request: StashCreateRequest };

export function stashAllRequest(options: StashAllOptions): StashCreateRequest {
  return {
    mode: 'all',
    message: options.message.trim(),
    includeUntracked: options.includeNewFiles,
  };
}

/**
 * Command argument for Create Stash. A sidebar node has neither field, so the
 * stash prompt still runs. A payload skips the prompt.
 */
export function parseStashCreateArg(value: unknown): StashCreateArg {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { status: 'absent' };
  }
  const record = value as Record<string, unknown>;
  if (!('message' in record) && !('includeNewFiles' in record)) {
    return { status: 'absent' };
  }
  if (typeof record.message !== 'string') {
    return { status: 'invalid', message: l10n.t('Stash message must be text') };
  }
  if (record.includeNewFiles !== undefined && typeof record.includeNewFiles !== 'boolean') {
    return { status: 'invalid', message: l10n.t('Include newly created files must be true or false') };
  }
  return {
    status: 'ready',
    request: stashAllRequest({
      message: record.message,
      includeNewFiles: record.includeNewFiles === true,
    }),
  };
}
