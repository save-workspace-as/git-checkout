import type { GraphCommitDto } from '../../src/shared/graph/graphProtocol';

/**
 * The commits drawn that the checked-out commit reaches through its parents, itself included, or undefined when it is
 * not drawn (a filtered graph). Parents come after their children, so one pass is enough.
 */
export function headHistory(commits: readonly GraphCommitDto[]): Set<string> | undefined {
  const head = commits.find((commit) => commit.refs.some((ref) => ref.isHead || ref.kind === 'head'));
  if (!head) {
    return undefined;
  }
  const reached = new Set([head.sha]);
  for (const commit of commits) {
    if (reached.has(commit.sha)) {
      commit.parents.forEach((parent) => reached.add(parent));
    }
  }
  return reached;
}
