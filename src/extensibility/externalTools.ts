import * as l10n from '@vscode/l10n';

export type ExternalToolKind = 'diff' | 'merge';

export interface ExternalToolPlan {
  kind: ExternalToolKind;
  args: string[];
  remoteWarning: string | null;
}

export type ExternalToolDecision =
  | { status: 'disabled'; message: string }
  | { status: 'unconfigured'; message: string }
  | { status: 'ready'; plan: ExternalToolPlan };

export function pickConfiguredTool(
  guiTool: string | null | undefined,
  tool: string | null | undefined,
): string | null {
  const gui = guiTool?.trim() ?? '';
  if (gui) {
    return gui;
  }
  const plain = tool?.trim() ?? '';
  return plain || null;
}

export function externalToolGitArgs(
  kind: ExternalToolKind,
  paths: readonly string[],
  /** Commits to compare instead of the working tree, for `diff`. */
  revisions: readonly string[] = [],
): string[] {
  const args = [kind === 'diff' ? 'difftool' : 'mergetool', '--no-prompt'];
  if (kind === 'diff') {
    args.push('-g');
    args.push(...revisions);
  }
  if (paths.length > 0) {
    args.push('--', ...paths);
  }
  return args;
}

export function externalToolRemoteWarning(
  remoteName: string | null | undefined,
  kind: ExternalToolKind,
): string | null {
  if (!remoteName) {
    return null;
  }
  const tool = kind === 'diff' ? 'difftool' : 'mergetool';
  return l10n.t(
    'git {0} runs on the workspace host ({1}). The GUI tool must be installed there. A tool that exists only on your local machine will not open.',
    tool,
    remoteName,
  );
}

export function decideExternalTool(input: {
  kind: ExternalToolKind;
  enabled: boolean;
  remoteName: string | null;
  configuredTool: string | null;
  paths: readonly string[];
  revisions?: readonly string[];
}): ExternalToolDecision {
  const tool = input.kind === 'diff' ? 'diff' : 'merge';
  if (!input.enabled) {
    const command = input.kind === 'diff' ? 'git difftool' : 'git mergetool';
    const setting =
      input.kind === 'diff' ? 'gitCheckout.externalDiff.enabled' : 'gitCheckout.externalMerge.enabled';
    return {
      status: 'disabled',
      message: l10n.t(
        'In-app {0} stays the default. Enable {1} to run {2} on the workspace host. GUI tools must be installed on that host, including when the folder is remote.',
        tool,
        setting,
        command,
      ),
    };
  }
  if (!input.configuredTool) {
    const keys = input.kind === 'diff' ? 'diff.tool or diff.guitool' : 'merge.tool or merge.guitool';
    return {
      status: 'unconfigured',
      message: l10n.t(
        'No {0} tool is configured. Set {1}. The tool must be installed on the workspace host (the remote machine for SSH, WSL, or Dev Containers).',
        tool,
        keys,
      ),
    };
  }
  return {
    status: 'ready',
    plan: {
      kind: input.kind,
      args: externalToolGitArgs(input.kind, input.paths, input.revisions),
      remoteWarning: externalToolRemoteWarning(input.remoteName, input.kind),
    },
  };
}
