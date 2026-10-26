import { isSafeGitToken, splitUpstream } from './pullOptions';
import * as l10n from '@vscode/l10n';

export interface FetchChoices {
  remote: string;
  /** Fetch every configured remote (`git fetch --all`). */
  all: boolean;
}

export interface FetchCatalog {
  remotes: string[];
  upstreamRemote: string | null;
}

export interface FetchCatalogSource {
  execRead(args: string[]): Promise<{ stdout: string }>;
}

export function fetchCliArgs(choices: Pick<FetchChoices, 'remote' | 'all'>): string[] {
  if (choices.all) {
    return ['fetch', '--all'];
  }
  if (!isSafeGitToken(choices.remote)) {
    throw new Error(l10n.t('Choose a remote name to fetch from.'));
  }
  return ['fetch', '--', choices.remote];
}

export function initialFetchChoices(catalog: FetchCatalog): FetchChoices {
  return { remote: defaultRemote(catalog), all: false };
}

export function parseFetchCommandArg(value: unknown): FetchChoices | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const all = record.all === true;
  const remote = typeof record.remote === 'string' ? record.remote.trim() : '';
  if (all) {
    if (remote && !isSafeGitToken(remote)) {
      return undefined;
    }
    return { remote, all: true };
  }
  if (!isSafeGitToken(remote)) {
    return undefined;
  }
  return { remote, all: false };
}

export async function loadFetchCatalog(
  cli: FetchCatalogSource,
  upstreamName: string | null,
): Promise<FetchCatalog> {
  const remoteOut = await cli.execRead(['remote']);
  return {
    remotes: parseRemoteList(remoteOut.stdout),
    upstreamRemote: splitUpstream(upstreamName).remote,
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

function defaultRemote(catalog: FetchCatalog): string {
  if (catalog.upstreamRemote && catalog.remotes.includes(catalog.upstreamRemote)) {
    return catalog.upstreamRemote;
  }
  if (catalog.remotes.includes('origin')) {
    return 'origin';
  }
  return catalog.remotes[0] ?? '';
}
