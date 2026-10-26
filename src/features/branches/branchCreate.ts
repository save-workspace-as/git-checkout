import { autoStashMessage } from './autoStash';
import * as l10n from '@vscode/l10n';
import type { GitCli } from '../../core/gitCli';
import { isSafeGitToken } from '../sync/pullOptions';
import type {
  BranchCreateRequest,
  BranchLocalChanges,
} from '../../shared/branches/branchCreate';
import { createLogger } from '../../log';

const log = createLogger('branch-create');


export type BranchCreateArg =
  | { status: 'absent' }
  | { status: 'invalid'; message: string }
  | { status: 'ready'; request: BranchCreateRequest };

export function validateBranchName(name: string): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) {
    return l10n.t('Name is required');
  }
  if (
    trimmed.endsWith('/') ||
    trimmed.endsWith('-') ||
    trimmed.endsWith('_') ||
    trimmed.endsWith('.')
  ) {
    return l10n.t('Add a name after the prefix');
  }
  if (!isSafeGitToken(trimmed)) {
    return l10n.t('Enter a branch name without spaces or options');
  }
  return undefined;
}

export function validateStartPoint(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith('-') || /[\u0000-\u0020\u007f]/.test(trimmed)) {
    return l10n.t('Enter a start point without spaces or options');
  }
  return undefined;
}

export function branchCreateGitArgs(request: BranchCreateRequest): string[] {
  const nameProblem = validateBranchName(request.name);
  if (nameProblem) {
    throw new Error(nameProblem);
  }
  const start = request.startPoint?.trim() ?? '';
  const startProblem = validateStartPoint(start);
  if (startProblem) {
    throw new Error(startProblem);
  }
  const name = request.name.trim();
  if (request.checkout) {
    return start ? ['switch', '-c', name, start] : ['switch', '-c', name];
  }
  return start ? ['branch', name, start] : ['branch', name];
}

export function parseBranchCreateArg(value: unknown): BranchCreateArg {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { status: 'absent' };
  }
  const record = value as Record<string, unknown>;
  if (!('name' in record || 'checkout' in record || 'localChanges' in record || 'startPoint' in record)) {
    return { status: 'absent' };
  }
  if (typeof record.name !== 'string') {
    return { status: 'invalid', message: l10n.t('Name is required') };
  }
  const name = record.name.trim();
  const nameProblem = validateBranchName(name);
  if (nameProblem) {
    return { status: 'invalid', message: nameProblem };
  }
  let startPoint: string | undefined;
  if (record.startPoint !== undefined) {
    if (typeof record.startPoint !== 'string') {
      return { status: 'invalid', message: l10n.t('Enter a start point without spaces or options') };
    }
    const start = record.startPoint.trim();
    const startProblem = validateStartPoint(start);
    if (startProblem) {
      return { status: 'invalid', message: startProblem };
    }
    startPoint = start || undefined;
  }
  if (record.checkout !== undefined && typeof record.checkout !== 'boolean') {
    return { status: 'invalid', message: l10n.t('Checkout after creating must be true or false') };
  }
  if (record.localChanges !== undefined && !isLocalChanges(record.localChanges)) {
    return {
      status: 'invalid',
      message: l10n.t('Choose whether to keep, stash, or discard local changes'),
    };
  }
  return {
    status: 'ready',
    request: {
      name,
      startPoint,
      checkout: record.checkout === true,
      localChanges: isLocalChanges(record.localChanges) ? record.localChanges : 'keep',
    },
  };
}

export async function executeBranchCreate(cli: GitCli, request: BranchCreateRequest): Promise<void> {
  const args = branchCreateGitArgs(request);
  log.info(
    `create branch ${request.name.trim()} checkout=${request.checkout} localChanges=${request.localChanges}`,
  );
  let stashed = false;
  try {
    if (request.localChanges === 'discard') {
      if (await workingTreeDirty(cli)) {
        await cli.execWrite(['reset', '--hard'], { showErrorToast: true });
        await cli.execWrite(['clean', '-fd'], { showErrorToast: true });
      }
    } else if (request.localChanges === 'stash' && (await workingTreeDirty(cli))) {
      await cli.execWrite(['stash', 'push', '-u', '-m', autoStashMessage()], { showErrorToast: true });
      stashed = true;
    }
    await cli.execWrite(args, { showErrorToast: true });
  } catch (error) {
    if (stashed) {
      try {
        await cli.execWrite(['stash', 'pop'], { showErrorToast: true });
      } catch (popError) {
        log.warn('stash pop failed after create branch', popError);
      }
    }
    throw error;
  }
  if (stashed) {
    await cli.execWrite(['stash', 'pop'], { showErrorToast: true });
  }
}

async function workingTreeDirty(cli: GitCli): Promise<boolean> {
  const result = await cli.execRead(['status', '--porcelain']);
  return result.stdout.trim().length > 0;
}

function isLocalChanges(value: unknown): value is BranchLocalChanges {
  return value === 'keep' || value === 'stash' || value === 'discard';
}
