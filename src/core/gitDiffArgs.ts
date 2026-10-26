import type { DiffWhitespaceMode, WorkingCopyDiffViewOptions } from '../shared/diff/diffViewOptions';
import type { WorkingCopyDiffSide } from '../shared/changes/workingCopyProtocol';

export function gitDiffWhitespaceFlags(mode: DiffWhitespaceMode): string[] {
  switch (mode) {
    case 'ignore':
      return ['-w'];
    case 'normal':
    case 'show':
      return [];
    default:
      return [];
  }
}

export function buildWorkingCopyDiffArgs(
  side: WorkingCopyDiffSide,
  repoRelativePath: string,
  options: WorkingCopyDiffViewOptions,
): string[] {
  const rel = repoRelativePath.replace(/\\/g, '/');
  const base =
    side === 'staged'
      ? ['diff', '--cached', '--no-color']
      : ['diff', '--no-color'];
  const flags = [...gitDiffWhitespaceFlags(options.whitespace)];
  return [...base, ...flags, '--', rel];
}
