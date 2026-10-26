import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';

export type GitBindingState =
  | 'ready'
  | 'git_extension_missing'
  | 'git_disabled'
  | 'api_unavailable';

export interface RepositoryDiagnostic {
  rootPath: string;
  headName: string | null;
}

export interface WorkspaceDiagnostics {
  bindingState: GitBindingState;
  remoteName: string | null;
  extensionKind: string;
  gitExtensionEnabled: boolean;
  gitPath: string | null;
  /** Set when `api.git.path` was ignored because this host cannot run it. */
  gitPathWarning?: string | null;
  repositories: RepositoryDiagnostic[];
}

export function formatDiagnostics(diagnostics: WorkspaceDiagnostics): string {
  const lines: string[] = [
    '--- Git Checkout diagnostics ---',
    `binding: ${diagnostics.bindingState}`,
    `remote: ${diagnostics.remoteName ?? 'local'}`,
    `extension kind: ${diagnostics.extensionKind}`,
    `vscode.git enabled: ${diagnostics.gitExtensionEnabled}`,
    `git.path: ${diagnostics.gitPath ?? '(unavailable)'}`,
    `repositories: ${diagnostics.repositories.length}`,
  ];

  if (diagnostics.gitPathWarning) {
    lines.push(diagnostics.gitPathWarning);
  }

  for (const repo of diagnostics.repositories) {
    const head = repo.headName ?? '(no branch)';
    lines.push(`  - ${repo.rootPath}  [${head}]`);
  }

  if (diagnostics.bindingState === 'git_disabled') {
    lines.push('');
    lines.push(
      l10n.t('Enable the built-in Git extension (vscode.git). Do not set git.enabled to false.'),
    );
  }

  if (diagnostics.bindingState === 'git_extension_missing') {
    lines.push('');
    lines.push(
      l10n.t(
        'vscode.git is not available on this extension host. Git Checkout must run as a workspace extension next to vscode.git.',
      ),
    );
  }

  lines.push('---');
  return lines.join('\n');
}

export function extensionKindLabel(kind: vscode.ExtensionKind | undefined): string {
  // Matches vscode.ExtensionKind: UI = 1, Workspace = 2.
  if (kind === 2) {
    return 'workspace';
  }
  if (kind === 1) {
    return 'ui';
  }
  return 'unknown';
}
