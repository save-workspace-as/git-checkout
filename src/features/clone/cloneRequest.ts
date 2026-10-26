import * as l10n from '@vscode/l10n';
import { existsSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { validateRemoteUrl } from '../sync/addRemote';

export interface CloneRequest {
  url: string;
  /** The folder that will hold the new repository folder. */
  location: string;
}

export type CloneArg =
  | { status: 'absent' }
  | { status: 'invalid'; message: string }
  | { status: 'ready'; request: CloneRequest };

/** The folder name `git clone` picks for a URL: `git@host:org/project.git` becomes `project`. */
export function repositoryNameFromUrl(url: string): string {
  const trimmed = url.trim().replace(/[\\/]+$/, '').replace(/\.git$/i, '');
  const name = trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf(':'), trimmed.lastIndexOf('\\')) + 1);
  return name === '.' || name === '..' ? '' : name;
}

export function cloneTarget(request: CloneRequest): string {
  return path.join(request.location.trim(), repositoryNameFromUrl(request.url));
}

export function validateCloneLocation(location: string): string | undefined {
  const trimmed = location.trim();
  if (!trimmed) {
    return l10n.t('Choose a folder for the repository.');
  }
  if (!path.isAbsolute(trimmed)) {
    return l10n.t('Enter the full path of a folder.');
  }
  if (existsSync(trimmed) && !statSync(trimmed).isDirectory()) {
    return l10n.t('The location is a file, not a folder.');
  }
  return undefined;
}

export function validateClone(request: CloneRequest): { url?: string; location?: string } {
  const errors: { url?: string; location?: string } = {};
  const url = validateRemoteUrl(request.url);
  if (url) {
    errors.url = url;
  }
  const location = validateCloneLocation(request.location);
  if (location) {
    errors.location = location;
  } else if (!url) {
    const name = repositoryNameFromUrl(request.url);
    if (!name) {
      errors.url = l10n.t('Enter a URL that ends with the repository name.');
    } else {
      const target = cloneTarget(request);
      if (existsSync(target) && (!statSync(target).isDirectory() || readdirSync(target).length > 0)) {
        errors.location = l10n.t('{0} already exists and is not empty.', target);
      }
    }
  }
  return errors;
}

export function cloneGitArgs(request: CloneRequest): string[] {
  const errors = validateClone(request);
  const problem = errors.url ?? errors.location;
  if (problem) {
    throw new Error(problem);
  }
  return ['clone', '--progress', '--', request.url.trim(), cloneTarget(request)];
}

export function parseCloneArg(value: unknown): CloneArg {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { status: 'absent' };
  }
  const record = value as Record<string, unknown>;
  if (!('url' in record) && !('location' in record)) {
    return { status: 'absent' };
  }
  if (typeof record.url !== 'string') {
    return { status: 'invalid', message: l10n.t('URL is required') };
  }
  if (typeof record.location !== 'string') {
    return { status: 'invalid', message: l10n.t('Choose a folder for the repository.') };
  }
  const request = { url: record.url.trim(), location: record.location.trim() };
  const errors = validateClone(request);
  const problem = errors.url ?? errors.location;
  return problem ? { status: 'invalid', message: problem } : { status: 'ready', request };
}

export interface CloneProgress {
  phase: 'receiving' | 'resolving';
  /** Overall progress from 0 to 100: receiving is the first 80 percent, resolving deltas the rest. */
  percent: number;
}

const PHASES = {
  receiving: { start: 0, span: 80 },
  resolving: { start: 80, span: 20 },
} as const;

/** Reads the newest percentage in a piece of `git clone --progress` output, which Git redraws with carriage returns. */
export function parseCloneProgress(chunk: string): CloneProgress | undefined {
  let found: CloneProgress | undefined;
  for (const line of chunk.split(/[\r\n]+/)) {
    const match = /^(?:remote: )?(receiving) objects:\s+(\d+)%|^(?:remote: )?(resolving) deltas:\s+(\d+)%/i.exec(line.trim());
    const phase = (match?.[1] ?? match?.[3])?.toLowerCase() as keyof typeof PHASES | undefined;
    const percent = Number(match?.[2] ?? match?.[4]);
    if (phase) {
      const { start, span } = PHASES[phase];
      found = { phase, percent: Math.round(start + (percent / 100) * span) };
    }
  }
  return found;
}
