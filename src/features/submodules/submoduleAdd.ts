import * as path from 'node:path';
import * as l10n from '@vscode/l10n';
import { validateStartPoint } from '../branches/branchCreate';

export interface SubmoduleAddRequest {
  url: string;
  path: string;
  branch: string;
  recursive?: boolean;
}

export function validateSubmoduleAdd(request: SubmoduleAddRequest): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!request.url.trim() || request.url.trim().startsWith('-') || /[\u0000-\u001f\u007f]/.test(request.url)) {
    errors.url = l10n.t('Enter a repository URL or local path without options or control characters.');
  }
  const destination = request.path.trim();
  if (!destination || path.isAbsolute(destination) || destination.startsWith('-')
    || /[\u0000-\u001f\u007f]/.test(destination)
    || destination.split(/[\\/]/).some((part) => part === '..' || part.toLowerCase() === '.git')
    || path.normalize(destination) === '.') {
    errors.path = l10n.t('Enter a relative folder inside this repository, outside .git.');
  }
  const branch = validateStartPoint(request.branch);
  if (branch) { errors.branch = branch; }
  return errors;
}

export function submoduleAddArgs(request: SubmoduleAddRequest): string[] {
  const errors = validateSubmoduleAdd(request);
  if (Object.keys(errors).length) {
    throw new Error(Object.values(errors).join('\n'));
  }
  const branch = request.branch.trim();
  return ['submodule', 'add', ...(branch ? ['-b', branch] : []), '--', request.url.trim(), request.path.trim()];
}
