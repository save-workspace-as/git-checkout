import * as l10n from '@vscode/l10n';
import type { GitCli } from '../../core/gitCli';
import { GitCliError } from '../../core/gitCliError';
import { isSafeGitToken } from './pullOptions';
import type { AddRemoteRequest } from '../../shared/branches/refsProtocol';
import { createLogger } from '../../log';

const log = createLogger('add-remote');

const REMOTE_TEST_TIMEOUT_MS = 15_000;
const SCHEME_URL = /^[a-z][a-z0-9+.-]*:\/\//i;
const SCP_URL = /^(?:[^@\s]+@)?[^:\s]+:\S+$/;

export type AddRemoteArg =
  | { status: 'absent' }
  | { status: 'invalid'; message: string }
  | { status: 'ready'; request: AddRemoteRequest };

export function validateRemoteName(
  name: string,
  existing: readonly string[] = [],
): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) {
    return l10n.t('Name is required');
  }
  if (!isSafeGitToken(trimmed)) {
    return l10n.t('Enter a remote name without spaces or options');
  }
  if (existing.includes(trimmed)) {
    return l10n.t('Remote already exists');
  }
  return undefined;
}

export function validateRemoteUrl(url: string): string | undefined {
  const trimmed = url.trim();
  if (!trimmed) {
    return l10n.t('URL is required');
  }
  if (trimmed.startsWith('-') || /[\u0000-\u0020\u007f]/.test(trimmed)) {
    return l10n.t('Enter a remote URL without spaces or options');
  }
  if (
    SCHEME_URL.test(trimmed) ||
    SCP_URL.test(trimmed) ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../')
  ) {
    return undefined;
  }
  return l10n.t('Enter a Git remote URL');
}

export function parseRemoteNames(output: string): string[] {
  const names: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const name = line.trim();
    if (name && !names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

export function addRemoteGitArgs(request: AddRemoteRequest): string[] {
  const nameProblem = validateRemoteName(request.name);
  if (nameProblem) {
    throw new Error(nameProblem);
  }
  const urlProblem = validateRemoteUrl(request.url);
  if (urlProblem) {
    throw new Error(urlProblem);
  }
  return ['remote', 'add', '--', request.name.trim(), request.url.trim()];
}

export function remoteTestGitArgs(url: string): string[] {
  const problem = validateRemoteUrl(url);
  if (problem) {
    throw new Error(problem);
  }
  return ['ls-remote', '--', url.trim()];
}

export function remoteTestFailureMessage(stderr: string, timedOut: boolean): string {
  if (timedOut) {
    return l10n.t('The remote did not respond in time');
  }
  const lower = stderr.toLowerCase();
  if (
    lower.includes('authentication failed') ||
    lower.includes('could not read username') ||
    lower.includes('permission denied')
  ) {
    return l10n.t('The remote requires authentication');
  }
  if (
    lower.includes('not found') ||
    lower.includes('does not appear to be a git repository')
  ) {
    return l10n.t('The remote repository was not found');
  }
  return l10n.t('Could not reach the remote URL');
}

export function parseAddRemoteArg(value: unknown): AddRemoteArg {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { status: 'absent' };
  }
  const record = value as Record<string, unknown>;
  if (!('name' in record) && !('url' in record)) {
    return { status: 'absent' };
  }
  if (typeof record.name !== 'string') {
    return { status: 'invalid', message: l10n.t('Name is required') };
  }
  if (typeof record.url !== 'string') {
    return { status: 'invalid', message: l10n.t('URL is required') };
  }
  const name = record.name.trim();
  const url = record.url.trim();
  const nameProblem = validateRemoteName(name);
  if (nameProblem) {
    return { status: 'invalid', message: nameProblem };
  }
  const urlProblem = validateRemoteUrl(url);
  if (urlProblem) {
    return { status: 'invalid', message: urlProblem };
  }
  return { status: 'ready', request: { name, url } };
}

export async function listRemoteNames(cli: GitCli): Promise<string[]> {
  const result = await cli.execRead(['remote']);
  return parseRemoteNames(result.stdout);
}

export async function testRemoteUrl(cli: GitCli, url: string): Promise<string | undefined> {
  const problem = validateRemoteUrl(url);
  if (problem) {
    return problem;
  }
  try {
    await cli.execRead(remoteTestGitArgs(url), {
      network: true,
      timeoutMs: REMOTE_TEST_TIMEOUT_MS,
    });
    return undefined;
  } catch (error) {
    log.warn('remote URL test failed', error);
    const stderr = error instanceof GitCliError ? error.stderr : '';
    const timedOut = error instanceof GitCliError && error.code === 'Timeout';
    return remoteTestFailureMessage(stderr, timedOut);
  }
}

export async function executeAddRemote(cli: GitCli, request: AddRemoteRequest): Promise<void> {
  const args = addRemoteGitArgs(request);
  const name = request.name.trim();
  const existing = await listRemoteNames(cli);
  if (existing.includes(name)) {
    throw new Error(l10n.t('Remote already exists'));
  }
  log.info(`add remote ${name}`);
  await cli.execWrite(args, { showErrorToast: true });
}
