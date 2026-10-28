import * as l10n from '@vscode/l10n';
import type { CommitPatchFormat } from '../../shared/patches/patchProtocol';

export type PatchApplyKind = 'mbox' | 'unified';

export function buildRangeFromOrderedShas(ordered: string[]): string {
  if (ordered.length === 0) {
    throw new Error(l10n.t('No commits selected.'));
  }
  const oldest = ordered[0];
  const newest = ordered[ordered.length - 1];
  if (oldest === newest) {
    return `${oldest}^..${newest}`;
  }
  return `${oldest}^..${newest}`;
}

export function buildBranchCommitRange(base: string, compare: string): string {
  const b = base.trim();
  const c = compare.trim();
  if (!b || !c) {
    throw new Error(l10n.t('Both branches are required.'));
  }
  return `${b}..${c}`;
}

export function gitArgsForPatchExport(range: string, format: CommitPatchFormat): string[] {
  if (format === 'format-patch') {
    return ['format-patch', '--stdout', range];
  }
  return ['diff', range];
}

export function detectPatchApplyKind(text: string): PatchApplyKind {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error(l10n.t('Patch text is empty.'));
  }
  if (/^From [0-9a-f]{7,40} /m.test(trimmed) || /^From .+ \w{3} /m.test(trimmed)) {
    return 'mbox';
  }
  return 'unified';
}

/** `createCommit` only matters for a patch saved with commit information; others change the files only. */
export function gitArgsForPatchApply(kind: PatchApplyKind, createCommit = true): string[] {
  if (kind === 'mbox' && createCommit) {
    return ['am', '--3way'];
  }
  return ['apply', '--3way'];
}

/** Applies nothing. Without `--3way`, which exits 0 when it leaves conflict markers, so a clash fails. */
export const PATCH_CHECK_ARGS = ['apply', '--check'];

export function mapPatchApplyError(stderr: string, exitCode: number | null): string {
  const lower = stderr.toLowerCase();
  if (lower.includes('unrecognized input') || lower.includes('corrupt patch')) {
    return l10n.t('This is not a valid Git patch.');
  }
  if (lower.includes('patch is empty') || lower.includes('already applied')) {
    return l10n.t('The patch is empty or already applied.');
  }
  if (lower.includes('patch does not apply') || lower.includes('does not match')) {
    return l10n.t('The patch does not apply cleanly. Check for conflicting local changes.');
  }
  if (lower.includes('merge conflict') || lower.includes('conflict in')) {
    return l10n.t(
      'Applying the patch stopped due to merge conflicts. Resolve conflicts, then continue or abort the operation.',
    );
  }
  if (lower.includes('previous rebase') || lower.includes('am in progress') || lower.includes('.git/rebase-apply')) {
    return l10n.t(
      'A patch or rebase operation is already in progress. Finish or abort it before applying another patch.',
    );
  }
  if (lower.includes('not a git repository')) {
    return l10n.t('This folder is not a Git repository.');
  }
  const trimmed = stderr.trim();
  if (trimmed) {
    const firstLine = trimmed.split('\n')[0];
    return firstLine.length > 240 ? `${firstLine.slice(0, 237)}…` : firstLine;
  }
  return exitCode !== null
    ? l10n.t('Patch apply failed (exit {0}).', exitCode)
    : l10n.t('Patch apply failed.');
}

export function defaultPatchFileName(range: string, format: CommitPatchFormat): string {
  const safe = range.replace(/[^\w.-]+/g, '_').replace(/_+/g, '_');
  const ext = format === 'format-patch' ? 'patch' : 'diff';
  return `git-checkout-${safe}.${ext}`;
}
