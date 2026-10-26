import * as l10n from '@vscode/l10n';
import { existsSync, readdirSync, statSync } from 'node:fs';
import * as path from 'path';

import type { WorktreeCreateRequest } from '../../shared/worktrees/worktreeProtocol';
import { validateBranchName, validateStartPoint } from '../branches/branchCreate';
import { sameWorktreePath } from './worktreeParser';

export interface WorktreeCreateContext {
  repoRoot: string;
  branchNames: readonly string[];
  worktrees: readonly { path: string; branch: string | null }[];
}

export type WorktreeCreateArg =
  | { status: 'absent' }
  | { status: 'invalid'; message: string }
  | { status: 'ready'; request: WorktreeCreateRequest };

/** Shown when a chosen folder already has files. */
export const WORKTREE_NONEMPTY_FOLDER = l10n.t('Choose an empty folder or a new path.');

export function suggestWorktreePath(repoRoot: string, name: string): string {
  const slug = name.trim().replace(/[\\/]+/g, '-') || 'worktree';
  return path.join(path.dirname(repoRoot), `${path.basename(repoRoot)}-${slug}`);
}

export function resolveWorktreeDestination(repoRoot: string, destination: string): string {
  return path.resolve(repoRoot, destination.trim());
}

/** Directory to open first when browsing for a worktree folder. */
export function worktreeBrowseStart(repoRoot: string, destination: string): string {
  const candidate = destination.trim()
    ? path.dirname(resolveWorktreeDestination(repoRoot, destination))
    : path.dirname(repoRoot);
  if (existsSync(candidate)) {
    try {
      if (statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch {
      // A broken parent falls through to the repository root.
    }
  }
  return repoRoot;
}

export function formatWorktreeCreatedMessage(request: WorktreeCreateRequest): string {
  const branch = request.newBranch?.trim() || request.startPoint?.trim() || 'HEAD';
  return l10n.t('Created worktree for {0} at {1}.', branch, request.path.trim());
}

export function validateWorktreeDestination(
  repoRoot: string,
  destination: string,
  worktrees: readonly { path: string }[],
): string | undefined {
  const trimmed = destination.trim();
  if (!trimmed) {
    return l10n.t('Choose a folder for the worktree.');
  }
  if (trimmed.startsWith('-')) {
    return l10n.t('Enter a folder path without options.');
  }
  const resolved = resolveWorktreeDestination(repoRoot, trimmed);
  if (sameWorktreePath(repoRoot, resolved)) {
    return l10n.t('Choose a folder other than the current worktree.');
  }
  if (worktrees.some((entry) => sameWorktreePath(entry.path, resolved))) {
    return 'A worktree already uses that folder.';
  }
  try {
    if (existsSync(resolved)) {
      const stat = statSync(resolved);
      if (!stat.isDirectory()) {
        return l10n.t('Choose a folder, not a file.');
      }
      if (readdirSync(resolved).length > 0) {
        return WORKTREE_NONEMPTY_FOLDER;
      }
      return undefined;
    }
    const parent = path.dirname(resolved);
    if (!existsSync(parent) || !statSync(parent).isDirectory()) {
      return l10n.t('The parent folder does not exist.');
    }
  } catch {
    // stat or readdir failed, so the folder is not a usable destination.
    return l10n.t('That folder cannot be used.');
  }
  return undefined;
}

export function validateNewWorktreeBranch(
  name: string,
  branchNames: readonly string[],
): string | undefined {
  const problem = validateBranchName(name);
  if (problem) {
    return problem;
  }
  const trimmed = name.trim();
  if (branchNames.includes(trimmed)) {
    return l10n.t('Branch already exists.');
  }
  return undefined;
}

export function validateWorktreeCreate(
  request: WorktreeCreateRequest,
  context: WorktreeCreateContext,
): string | undefined {
  const destination = validateWorktreeDestination(context.repoRoot, request.path, context.worktrees);
  if (destination) {
    return destination;
  }
  const branch = request.newBranch?.trim() ?? '';
  const start = request.startPoint?.trim() ?? '';
  if (branch) {
    const nameProblem = validateNewWorktreeBranch(branch, context.branchNames);
    if (nameProblem) {
      return nameProblem;
    }
    return validateStartPoint(start);
  }
  if (!start) {
    return l10n.t('Choose a branch to Checkout.');
  }
  const startProblem = validateStartPoint(start);
  if (startProblem) {
    return startProblem;
  }
  if (!context.branchNames.includes(start)) {
    return l10n.t('Choose an existing branch.');
  }
  const ref = `refs/heads/${start}`;
  if (context.worktrees.some((entry) => entry.branch === ref)) {
    return l10n.t('That branch is already checked out in a worktree.');
  }
  return undefined;
}

export function normalizeWorktreeCreateRequest(
  request: WorktreeCreateRequest,
  repoRoot: string,
): WorktreeCreateRequest {
  const start = request.startPoint?.trim() ?? '';
  const branch = request.newBranch?.trim() ?? '';
  const normalized: WorktreeCreateRequest = {
    path: resolveWorktreeDestination(repoRoot, request.path),
  };
  if (branch) {
    normalized.newBranch = branch;
  }
  if (start && start !== 'HEAD') {
    normalized.startPoint = start;
  }
  return normalized;
}

export function parseWorktreeCreateArg(
  value: unknown,
  context: WorktreeCreateContext,
): WorktreeCreateArg {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { status: 'absent' };
  }
  const record = value as Record<string, unknown>;
  if (!('path' in record) && !('newBranch' in record) && !('startPoint' in record)) {
    return { status: 'absent' };
  }
  if (typeof record.path !== 'string') {
    return { status: 'invalid', message: l10n.t('Choose a folder for the worktree.') };
  }
  if (record.newBranch !== undefined && typeof record.newBranch !== 'string') {
    return { status: 'invalid', message: l10n.t('Name is required') };
  }
  if (record.startPoint !== undefined && typeof record.startPoint !== 'string') {
    return { status: 'invalid', message: l10n.t('Enter a start point without spaces or options') };
  }
  const request: WorktreeCreateRequest = {
    path: record.path,
    newBranch: typeof record.newBranch === 'string' ? record.newBranch : undefined,
    startPoint: typeof record.startPoint === 'string' ? record.startPoint : undefined,
  };
  const problem = validateWorktreeCreate(request, context);
  if (problem) {
    return { status: 'invalid', message: problem };
  }
  return { status: 'ready', request: normalizeWorktreeCreateRequest(request, context.repoRoot) };
}
