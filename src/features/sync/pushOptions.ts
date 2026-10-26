import { isSafeGitToken, splitUpstream } from './pullOptions';
import * as l10n from '@vscode/l10n';

export interface PushChoices {
  remote: string;
  branch: string;
  /** Push every local tag along with the branch. */
  tags: boolean;
  /** Update a diverged remote branch with `--force-with-lease`. */
  force: boolean;
}

export interface PushCatalog {
  remotes: string[];
  localBranches: string[];
  headName: string | null;
  upstreamRemote: string | null;
  upstreamBranch: string | null;
}

export interface PushCatalogSource {
  execRead(args: string[]): Promise<{ stdout: string }>;
}

export interface PushCliParams {
  remoteName?: string;
  branchName: string;
  setUpstream?: boolean;
  forceWithLease?: boolean;
  skipHooks?: boolean;
  tags?: boolean;
}

export function pushCliArgs(params: PushCliParams): string[] {
  const args = ['push'];
  if (params.skipHooks) {
    args.push('--no-verify');
  }
  if (params.setUpstream) {
    args.push('-u');
  }
  if (params.forceWithLease) {
    args.push('--force-with-lease');
  }
  if (params.tags) {
    args.push('--tags');
  }
  if (!params.remoteName) {
    return args;
  }
  if (!isSafeGitToken(params.remoteName)) {
    throw new Error(l10n.t('Choose a remote name to push to.'));
  }
  if (!isSafeGitToken(params.branchName)) {
    throw new Error(l10n.t('Choose a branch name to push.'));
  }
  args.push('--', params.remoteName, params.branchName);
  return args;
}

export function initialPushChoices(catalog: PushCatalog): PushChoices {
  return {
    remote: defaultRemote(catalog),
    branch: defaultBranch(catalog),
    tags: false,
    force: false,
  };
}

export function orderedBranchNames(catalog: PushCatalog, current: string): string[] {
  const names = catalog.localBranches;
  const ordered = [
    ...(current && names.includes(current) ? [current] : []),
    ...names.filter((name) => name !== current),
  ];
  if (current && isSafeGitToken(current) && !ordered.includes(current)) {
    ordered.unshift(current);
  }
  return ordered;
}

export function parsePushCommandArg(value: unknown): PushChoices | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.remote !== 'string' || typeof record.branch !== 'string') {
    return undefined;
  }
  const remote = record.remote.trim();
  const branch = record.branch.trim();
  if (!isSafeGitToken(remote) || !isSafeGitToken(branch)) {
    return undefined;
  }
  return {
    remote,
    branch,
    tags: record.tags === true,
    force: record.force === true,
  };
}

export async function loadPushCatalog(
  cli: PushCatalogSource,
  headName: string | null,
  upstreamName: string | null,
): Promise<PushCatalog> {
  const [remoteOut, branchOut] = await Promise.all([
    cli.execRead(['remote']),
    cli.execRead(['for-each-ref', '--format=%(refname:short)', 'refs/heads/']),
  ]);
  const upstream = splitUpstream(upstreamName);
  return {
    remotes: parseRemoteList(remoteOut.stdout),
    localBranches: parseLocalBranches(branchOut.stdout),
    headName,
    upstreamRemote: upstream.remote,
    upstreamBranch: upstream.branch,
  };
}

function parseRemoteList(output: string): string[] {
  const remotes: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const name = line.trim();
    if (name && !remotes.includes(name)) {
      remotes.push(name);
    }
  }
  return remotes;
}

function parseLocalBranches(output: string): string[] {
  const branches: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const name = line.trim();
    if (name && !branches.includes(name)) {
      branches.push(name);
    }
  }
  branches.sort((a, b) => a.localeCompare(b));
  return branches;
}

function defaultRemote(catalog: PushCatalog): string {
  if (catalog.upstreamRemote && catalog.remotes.includes(catalog.upstreamRemote)) {
    return catalog.upstreamRemote;
  }
  if (catalog.remotes.includes('origin')) {
    return 'origin';
  }
  return catalog.remotes[0] ?? '';
}

function defaultBranch(catalog: PushCatalog): string {
  if (
    catalog.headName &&
    (catalog.localBranches.length === 0 || catalog.localBranches.includes(catalog.headName))
  ) {
    return catalog.headName;
  }
  if (catalog.upstreamBranch && catalog.localBranches.includes(catalog.upstreamBranch)) {
    return catalog.upstreamBranch;
  }
  return catalog.localBranches[0] ?? catalog.headName ?? '';
}
