import { type GraphRefDto } from './graphProtocol';

/**
 * Revision `git log` should walk. Active-branch mode follows the checked-out branch. Every commit it lists is in that
 * branch's history, so every branch label on one is a branch that is part of it (a feature built on `main` shows `main`).
 */
export function graphLogRevision(
  filterRef: string,
  headRef: string | null,
  activeBranchOnly: boolean,
): string {
  if (!activeBranchOnly) {
    return filterRef;
  }
  const branch = headRef?.trim();
  return branch ? branch : 'HEAD';
}

/**
 * One label for a local branch and the remote-tracking branches of the same name on the same commit
 * (`main` and `origin/main`), as long as they agree; a remote branch alone keeps its own label.
 */
export function compactGraphRefs(refs: readonly GraphRefDto[]): GraphRefDto[] {
  const local = new Map(refs.filter((ref) => ref.kind === 'local').map((ref) => [ref.name, ref]));
  const merged = new Map<string, string[]>();
  const kept: GraphRefDto[] = [];
  for (const ref of refs) {
    const slash = ref.name.indexOf('/');
    const branch = ref.kind === 'remote' && slash > 0 ? ref.name.slice(slash + 1) : undefined;
    if (branch !== undefined && local.has(branch)) {
      merged.set(branch, [...(merged.get(branch) ?? []), ref.name]);
      continue;
    }
    kept.push(ref);
  }
  return kept.map((ref) => (ref.kind === 'local' && merged.has(ref.name) ? { ...ref, remotes: merged.get(ref.name) } : ref));
}

