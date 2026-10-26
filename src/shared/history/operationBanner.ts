import * as l10n from '@vscode/l10n';
import type { RepoOperationDto } from './historyProtocol';

export interface OperationBannerModel {
  /** What is going on, for example "Rebasing 'main' → '7abd451' (rebased 4/7 commits)". */
  title: string;
  /** What to do next, for example "Fix 1 conflict with 'b627fbf' and then continue." */
  message: string;
  /** Share of a rebase already applied, 0 to 1. */
  progress?: number;
  /** Merge, rebase, cherry-pick and revert can be abandoned; a bisect is ended from the graph. */
  canAbort: boolean;
  /** Resolve while files conflict, Continue once none do; nothing for a bisect. */
  primary: 'resolve' | 'continue' | null;
}

/** Describes a stopped or running operation for the banner above the graph; `undefined` when there is none. */
export function describeOperation(op: RepoOperationDto): OperationBannerModel | undefined {
  if (!op.active && !op.conflicted) {
    return undefined;
  }
  const conflicts = op.conflictCount ?? 0;
  const conflicted = op.conflicted || conflicts > 0;
  const hasKind = op.kind !== null && op.kind !== 'bisect';
  return {
    title: titleFor(op, conflicted),
    message: messageFor(op, conflicted, conflicts),
    progress: op.progress && op.progress.total > 0 ? rebased(op, conflicted) / op.progress.total : undefined,
    canAbort: hasKind,
    primary: !hasKind ? null : conflicted ? 'resolve' : 'continue',
  };
}

/** The commit being applied counts as rebased only once it no longer conflicts. */
function rebased(op: RepoOperationDto, conflicted: boolean): number {
  const step = op.progress?.step ?? 0;
  return conflicted ? Math.max(0, step - 1) : step;
}

function titleFor(op: RepoOperationDto, conflicted: boolean): string {
  const { branch, target } = op;
  switch (op.kind) {
    case 'rebase': {
      if (!branch || !target) {
        return l10n.t('Rebasing');
      }
      return op.progress
        ? l10n.t("Rebasing '{0}' → '{1}' (rebased {2}/{3} commits)", branch, target, rebased(op, conflicted), op.progress.total)
        : l10n.t("Rebasing '{0}' → '{1}'", branch, target);
    }
    case 'merge':
      return target ? l10n.t("Merging '{0}'", target) : l10n.t('Merging');
    case 'cherry-pick':
      return target ? l10n.t("Cherry-picking '{0}'", target) : l10n.t('Cherry-picking');
    case 'revert':
      return target ? l10n.t("Reverting '{0}'", target) : l10n.t('Reverting');
    default:
      return op.summary || l10n.t('Repository operation in progress');
  }
}

function messageFor(op: RepoOperationDto, conflicted: boolean, conflicts: number): string {
  if (op.kind === 'bisect') {
    return l10n.t('Mark each commit as good or bad until Git finds the first bad commit.');
  }
  if (!conflicted) {
    return l10n.t('All conflicts are resolved. Continue to finish.');
  }
  if (conflicts <= 1 && op.commit) {
    return l10n.t("Fix 1 conflict with '{0}' and then continue.", op.commit);
  }
  if (conflicts === 1) {
    return l10n.t('Fix 1 conflict and then continue.');
  }
  if (conflicts > 1) {
    return l10n.t('Fix {0} conflicts and then continue.', conflicts);
  }
  return l10n.t('Fix the conflicts and then continue.');
}
