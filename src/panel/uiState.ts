import * as vscode from 'vscode';
import type { WorkspaceDiagnostics } from '../core/diagnostics';
import type {
  EmptyReason,
  PaneLayout,
  RepoOperationDto,
  SyncStatusDto,
  UiState,
  WorktreeStatusDto,
} from '../shared/protocol';
import { IDLE_REPO_OPERATION } from '../shared/history/historyProtocol';

const IDLE_SYNC: SyncStatusDto = { ahead: null, behind: null, upstream: null, busy: false };
const IDLE_WORKTREE: WorktreeStatusDto = { dirty: false, stagedCount: 0, unstagedCount: 0 };

export function buildUiState(
  diagnostics: WorkspaceDiagnostics,
  headShort: string | null,
  layout: PaneLayout,
  sync: SyncStatusDto = IDLE_SYNC,
  worktree: WorktreeStatusDto = IDLE_WORKTREE,
  operation: RepoOperationDto = IDLE_REPO_OPERATION,
): UiState {
  const folders = vscode.workspace.workspaceFolders;
  const repositories = diagnostics.repositories.map((r) => ({
    rootPath: r.rootPath,
    headName: r.headName,
  }));
  const activeRepoRoot = repositories[0]?.rootPath ?? null;

  if (!folders || folders.length === 0) {
    return emptyState(diagnostics.bindingState, 'noWorkspace', repositories, headShort, layout, sync, worktree, operation);
  }

  if (diagnostics.bindingState === 'git_disabled') {
    return emptyState(diagnostics.bindingState, 'gitDisabled', repositories, headShort, layout, sync, worktree, operation);
  }

  if (diagnostics.bindingState === 'git_extension_missing') {
    return emptyState(diagnostics.bindingState, 'gitMissing', repositories, headShort, layout, sync, worktree, operation);
  }

  if (diagnostics.bindingState === 'api_unavailable') {
    return emptyState(diagnostics.bindingState, 'apiUnavailable', repositories, headShort, layout, sync, worktree, operation);
  }

  if (repositories.length === 0) {
    return emptyState(diagnostics.bindingState, 'noRepository', repositories, headShort, layout, sync, worktree, operation);
  }

  return {
    empty: false,
    bindingState: diagnostics.bindingState,
    repositories,
    activeRepoRoot,
    headShort,
    layout,
    sync,
    worktree,
    operation,
  };
}

function emptyState(
  bindingState: WorkspaceDiagnostics['bindingState'],
  emptyReason: EmptyReason,
  repositories: UiState['repositories'],
  headShort: string | null,
  layout: PaneLayout,
  sync: SyncStatusDto,
  worktree: WorktreeStatusDto,
  operation: RepoOperationDto,
): UiState {
  return {
    empty: true,
    emptyReason,
    bindingState,
    repositories,
    activeRepoRoot: null,
    headShort,
    layout,
    sync,
    worktree,
    operation,
  };
}
