import type { RepositoryWatchSnapshot } from './gitRepositoryWatcher';

export function formatWatchVerifyReport(snapshots: RepositoryWatchSnapshot[]): string {
  const lines: string[] = ['Git watch verify:'];
  if (snapshots.length === 0) {
    lines.push('  (no active repository watchers)');
    return lines.join('\n');
  }

  for (const snap of snapshots) {
    lines.push(`  repo: ${snap.repoRoot}`);
    lines.push(`    watchersActive: ${snap.watchersActive}`);
    if (snap.layout) {
      lines.push(`    gitDir: ${snap.layout.gitDir}`);
      lines.push(`    commonDir: ${snap.layout.commonDir}`);
      lines.push(`    head: ${snap.layout.headPath}`);
      lines.push(`    index: ${snap.layout.indexPath}`);
      lines.push(`    refs: ${snap.layout.refsDir}`);
      lines.push(`    packed-refs: ${snap.layout.packedRefsPath}`);
      if (snap.layout.reftableDir) {
        lines.push(`    reftable: ${snap.layout.reftableDir}`);
      }
      lines.push(`    worktrees: ${snap.layout.worktreesDir}`);
      lines.push(`    modules: ${snap.layout.modulesDir}`);
    } else {
      lines.push('    layout: unresolved');
    }
    if (snap.lastRefreshAt !== null) {
      lines.push(
        `    lastRefresh: ${new Date(snap.lastRefreshAt).toISOString()} (${snap.lastRefreshReason}) HEAD=${snap.lastHeadShort ?? '?'}`,
      );
    } else {
      lines.push('    lastRefresh: (none)');
    }
  }
  return lines.join('\n');
}
