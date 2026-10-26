import * as l10n from '@vscode/l10n';

export interface PullChoices {
  remote: string;
  branch: string;
  rebase: boolean;
  stash: boolean;
  /** The local branch that receives the commits. Unset, or the checked-out branch, pulls into the working tree. */
  into?: string;
}

export interface PullCatalog {
  remotes: string[];
  localBranches: string[];
  branchesByRemote: Record<string, string[]>;
  headName: string | null;
  upstreamRemote: string | null;
  upstreamBranch: string | null;
  rebaseByDefault: boolean;
}

export interface PullCatalogSource {
  execRead(args: string[]): Promise<{ stdout: string }>;
}

export function splitUpstream(upstream: string | null): {
  remote: string | null;
  branch: string | null;
} {
  if (!upstream) {
    return { remote: null, branch: null };
  }
  const slash = upstream.indexOf('/');
  if (slash <= 0) {
    return { remote: null, branch: upstream };
  }
  return { remote: upstream.slice(0, slash), branch: upstream.slice(slash + 1) };
}

/** True when `pull.rebase` asks Git to rebase instead of merge. */
export function rebaseFromPullConfig(value: string | null | undefined): boolean {
  const normalized = value?.trim().toLowerCase() ?? '';
  return (
    normalized === 'true' ||
    normalized === '1' ||
    normalized === 'yes' ||
    normalized === 'on' ||
    normalized === 'merges' ||
    normalized === 'interactive'
  );
}

/** Ref token safe to pass after `--` (no options, no revision syntax). */
export function isSafeGitToken(value: string): boolean {
  if (
    !value ||
    value.startsWith('-') ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.endsWith('.') ||
    value.endsWith('.lock')
  ) {
    return false;
  }
  if (value.includes('..') || value.includes('@{') || value.includes('//')) {
    return false;
  }
  return !/[\u0000-\u0020\u007f~^:?*\[\\]/.test(value);
}

export function pullCliArgs(choices: Pick<PullChoices, 'remote' | 'branch' | 'rebase'>): string[] {
  if (!isSafeGitToken(choices.remote)) {
    throw new Error(l10n.t('Choose a remote name to pull from.'));
  }
  if (!isSafeGitToken(choices.branch)) {
    throw new Error(l10n.t('Choose a branch name to pull.'));
  }
  return ['pull', choices.rebase ? '--rebase' : '--no-rebase', '--', choices.remote, choices.branch];
}

/**
 * Brings a local branch that is not checked out up to a branch of a remote. Without a `+`, Git only allows a
 * fast-forward, so nothing is overwritten.
 */
export function pullIntoArgs(choices: Pick<PullChoices, 'remote' | 'branch'> & { into: string }): string[] {
  if (!isSafeGitToken(choices.remote)) {
    throw new Error(l10n.t('Choose a remote name to pull from.'));
  }
  if (!isSafeGitToken(choices.branch)) {
    throw new Error(l10n.t('Choose a branch name to pull.'));
  }
  if (!isSafeGitToken(choices.into)) {
    throw new Error(l10n.t('Choose a local branch to pull into.'));
  }
  return ['fetch', '--', choices.remote, `refs/heads/${choices.branch}:refs/heads/${choices.into}`];
}

export function branchNamesForRemote(catalog: PullCatalog, remote: string): string[] {
  return catalog.branchesByRemote[remote] ?? [];
}

export function initialPullChoices(catalog: PullCatalog, stashByDefault: boolean): PullChoices {
  const remote = defaultRemote(catalog);
  return {
    remote,
    branch: defaultBranch(catalog, remote),
    rebase: catalog.rebaseByDefault,
    stash: stashByDefault,
  };
}

export function pullChoicesForRemote(
  choices: PullChoices,
  catalog: PullCatalog,
  remote: string,
): PullChoices {
  const names = branchNamesForRemote(catalog, remote);
  const branch = names.includes(choices.branch) ? choices.branch : defaultBranch(catalog, remote);
  return { ...choices, remote, branch };
}

export function parsePullCommandArg(value: unknown): PullChoices | undefined {
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
    rebase: record.rebase === true,
    stash: record.stash === true,
  };
}

export async function loadPullCatalog(
  cli: PullCatalogSource,
  headName: string | null,
  upstreamName: string | null,
): Promise<PullCatalog> {
  const [remoteOut, branchOut, localOut, rebaseByDefault] = await Promise.all([
    cli.execRead(['remote']),
    cli.execRead(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/']),
    cli.execRead(['for-each-ref', '--format=%(refname:short)', 'refs/heads/']),
    readPullRebase(cli),
  ]);
  const upstream = splitUpstream(upstreamName);
  return {
    remotes: parseRemoteList(remoteOut.stdout),
    localBranches: localOut.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    branchesByRemote: parseRemoteBranchNames(branchOut.stdout),
    headName,
    upstreamRemote: upstream.remote,
    upstreamBranch: upstream.branch,
    rebaseByDefault,
  };
}

async function readPullRebase(cli: PullCatalogSource): Promise<boolean> {
  try {
    const result = await cli.execRead(['config', '--get', 'pull.rebase']);
    return rebaseFromPullConfig(result.stdout);
  } catch {
    // `git config --get` exits 1 when the key is unset.
    return false;
  }
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

function parseRemoteBranchNames(output: string): Record<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const line of output.split(/\r?\n/)) {
    const ref = line.trim();
    const slash = ref.indexOf('/');
    if (!ref || slash <= 0) {
      continue;
    }
    const remote = ref.slice(0, slash);
    const branch = ref.slice(slash + 1);
    if (branch === 'HEAD' || !branch) {
      continue;
    }
    const list = grouped.get(remote) ?? [];
    if (!list.includes(branch)) {
      list.push(branch);
    }
    grouped.set(remote, list);
  }
  const branchesByRemote: Record<string, string[]> = {};
  for (const [remote, names] of grouped) {
    names.sort((a, b) => a.localeCompare(b));
    branchesByRemote[remote] = names;
  }
  return branchesByRemote;
}

function defaultRemote(catalog: PullCatalog): string {
  if (catalog.upstreamRemote && catalog.remotes.includes(catalog.upstreamRemote)) {
    return catalog.upstreamRemote;
  }
  return catalog.remotes[0] ?? '';
}

function defaultBranch(catalog: PullCatalog, remote: string): string {
  const names = branchNamesForRemote(catalog, remote);
  if (
    catalog.upstreamRemote === remote &&
    catalog.upstreamBranch &&
    (names.length === 0 || names.includes(catalog.upstreamBranch))
  ) {
    return catalog.upstreamBranch;
  }
  if (catalog.headName && names.includes(catalog.headName)) {
    return catalog.headName;
  }
  if (names.length === 0 && catalog.headName) {
    return catalog.headName;
  }
  return names[0] ?? catalog.headName ?? '';
}
