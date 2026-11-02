import * as l10n from '@vscode/l10n';
import { formatCommitDate } from '../../shared/history/commitDate';
import type { GraphCommitDto } from '../../shared/graph/graphProtocol';

/** One line about the commit shown in the Commit view: its subject, who made it and when, and its hash. */
export function commitSummaryText(commit: GraphCommitDto, now: Date = new Date()): string {
  return l10n.t('{0} — {1}, {2} · {3}', commit.subject, commit.author, formatCommitDate(commit.authorDate, now), commit.sha.slice(0, 7));
}

/** What the Commit view says when two commits are compared. */
export function compareSummaryText(base: GraphCommitDto, commit: GraphCommitDto): string {
  return l10n.t('Changes from {0} to {1}', base.sha.slice(0, 7), commit.sha.slice(0, 7));
}
