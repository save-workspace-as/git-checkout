import * as l10n from '@vscode/l10n';

export const WINDOWS_GIT_PATH_REJECTED = l10n.t(
  'git.path from vscode.git is a Windows path, and this workspace host is not Windows. Git Checkout will not run it. On WSL, SSH, and Dev Containers, vscode.git must report the git binary on that host.',
);

export interface WorkspaceGitPath {
  path: string | null;
  warning: string | null;
}

/** Drive-letter and UNC paths that only a Windows host can execute. */
export function isWindowsAbsoluteGitPath(gitPath: string): boolean {
  const trimmed = gitPath.trim();
  return /^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith('\\\\');
}

/**
 * Uses `api.git.path` from vscode.git. A Windows drive-letter or UNC path is
 * kept only when the workspace host is Windows, so a User `git.path` from
 * Windows is not spawned inside WSL, Linux SSH, or a Linux Dev Container.
 */
export function resolveWorkspaceGitPath(
  apiGitPath: string | null | undefined,
  hostPlatform: NodeJS.Platform = process.platform,
): WorkspaceGitPath {
  const trimmed = apiGitPath?.trim() ?? '';
  if (!trimmed) {
    return { path: null, warning: null };
  }
  if (hostPlatform !== 'win32' && isWindowsAbsoluteGitPath(trimmed)) {
    return { path: null, warning: WINDOWS_GIT_PATH_REJECTED };
  }
  return { path: trimmed, warning: null };
}
