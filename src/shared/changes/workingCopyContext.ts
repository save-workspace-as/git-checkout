import type { WorkingCopyDiffSide } from './workingCopyProtocol';

/** `data-vscode-context` on a working-copy row that is a gitlink. */
export interface WorkingCopySubmoduleContext {
  webviewSection: 'workingCopy';
  path: string;
  side: WorkingCopyDiffSide;
  submodule: true;
}

export function workingCopySubmoduleContext(
  path: string,
  side: WorkingCopyDiffSide,
): WorkingCopySubmoduleContext {
  return { webviewSection: 'workingCopy', path, side, submodule: true };
}

export function isWorkingCopySubmoduleContext(value: unknown): value is WorkingCopySubmoduleContext {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<WorkingCopySubmoduleContext>;
  return (
    candidate.webviewSection === 'workingCopy' &&
    candidate.submodule === true &&
    typeof candidate.path === 'string' &&
    candidate.path.length > 0 &&
    (candidate.side === 'staged' || candidate.side === 'unstaged')
  );
}
