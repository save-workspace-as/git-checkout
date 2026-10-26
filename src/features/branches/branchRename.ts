import * as l10n from '@vscode/l10n';
import { validateBranchName } from './branchCreate';
import type { GitCli } from '../../core/gitCli';
import { isSafeGitToken, splitUpstream } from '../sync/pullOptions';
import type { BranchRenameRequest, BranchUpstream } from '../../shared/branches/branchRename';
import { createLogger } from '../../log';

const log = createLogger('branch-rename');

export type BranchRenameArg =
  | { status: 'absent'; oldName?: string }
  | { status: 'invalid'; message: string }
  | { status: 'ready'; oldName: string; request: BranchRenameRequest };

export function parseBranchRenameArg(value: unknown): BranchRenameArg {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { status: 'absent' };
  }
  const record = value as Record<string, unknown>;
  const oldName =
    typeof record.ref === 'string'
      ? record.ref
      : typeof record.oldName === 'string'
        ? record.oldName
        : undefined;
  const hasRequest = 'name' in record || 'renameRemote' in record;
  if (!hasRequest) {
    return oldName ? { status: 'absent', oldName } : { status: 'absent' };
  }
  if (!oldName) {
    return { status: 'invalid', message: l10n.t('Select a branch to rename.') };
  }
  if (typeof record.name !== 'string') {
    return { status: 'invalid', message: l10n.t('Name is required') };
  }
  const name = record.name.trim();
  const nameProblem = validateBranchName(name);
  if (nameProblem) {
    return { status: 'invalid', message: nameProblem };
  }
  if (name === oldName) {
    return { status: 'invalid', message: l10n.t('Enter a different branch name') };
  }
  if (record.renameRemote !== undefined && typeof record.renameRemote !== 'boolean') {
    return { status: 'invalid', message: l10n.t('Rename remote must be true or false') };
  }
  return {
    status: 'ready',
    oldName,
    request: {
      name,
      renameRemote: record.renameRemote === true,
    },
  };
}

/** Git argv lists for a local rename, plus the remote rename when requested. */
export function branchRenameCommands(
  oldName: string,
  request: BranchRenameRequest,
  upstream: BranchUpstream | null,
): string[][] {
  const newName = request.name.trim();
  const nameProblem = validateBranchName(newName);
  if (nameProblem) {
    throw new Error(nameProblem);
  }
  if (!isSafeGitToken(oldName)) {
    throw new Error(l10n.t('Enter a branch name without spaces or options'));
  }
  if (newName === oldName) {
    throw new Error(l10n.t('Enter a different branch name'));
  }
  const local = ['branch', '-m', oldName, newName];
  if (!request.renameRemote) {
    return [local];
  }
  if (!upstream || !isSafeGitToken(upstream.remote) || !isSafeGitToken(upstream.branch)) {
    throw new Error(l10n.t('Branch "{0}" has no remote to rename.', oldName));
  }
  const commands = [local, ['push', upstream.remote, `${newName}:${newName}`]];
  if (upstream.branch !== newName) {
    commands.push(['push', upstream.remote, '--delete', upstream.branch]);
  }
  commands.push(['branch', '--set-upstream-to', `${upstream.remote}/${newName}`, newName]);
  return commands;
}

export async function readBranchUpstream(
  cli: GitCli,
  branch: string,
): Promise<BranchUpstream | null> {
  if (!isSafeGitToken(branch)) {
    return null;
  }
  try {
    const result = await cli.execRead(['rev-parse', '--abbrev-ref', `${branch}@{upstream}`]);
    const split = splitUpstream(result.stdout.trim() || null);
    if (
      !split.remote ||
      !split.branch ||
      !isSafeGitToken(split.remote) ||
      !isSafeGitToken(split.branch)
    ) {
      return null;
    }
    return { remote: split.remote, branch: split.branch };
  } catch (error) {
    // `rev-parse branch@{upstream}` exits 128 when the branch has no upstream.
    log.debug(`no upstream for ${branch}`, error);
    return null;
  }
}

export async function executeBranchRename(
  cli: GitCli,
  oldName: string,
  request: BranchRenameRequest,
  upstream: BranchUpstream | null,
): Promise<void> {
  const commands = branchRenameCommands(oldName, request, upstream);
  const newName = request.name.trim();
  const remote =
    request.renameRemote && upstream ? `${upstream.remote}/${upstream.branch}` : 'no';
  log.info(`rename ${oldName} to ${newName} remote=${remote}`);
  for (const args of commands) {
    await cli.execWrite(args, {
      showErrorToast: true,
      network: args[0] === 'push',
    });
  }
}
