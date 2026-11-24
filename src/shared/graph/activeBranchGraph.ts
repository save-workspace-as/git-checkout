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


/**
 * In active-branch mode a label is shown only for the checked-out branch and its upstream branch. Every other
 * branch, tag and stash label is dropped, since those are not what the mode is about.
 */
export function activeBranchLabels(refs: readonly GraphRefDto[], upstream: string | null): GraphRefDto[] {
  return refs.filter((ref) => ref.kind === 'head' || (ref.kind === 'local' && ref.isHead === true) || (ref.kind === 'remote' && ref.name === upstream));
}

/** A commit with only the labels of the checked-out branch, and the names of the ones left out. */
export function withActiveBranchLabels<T extends { refs: GraphRefDto[] }>(commit: T, upstream: string | null): T & { hiddenRefs?: string[] } {
  const refs = activeBranchLabels(commit.refs, upstream);
  const hidden = commit.refs.filter((ref) => !refs.includes(ref)).map((ref) => ref.name);
  return hidden.length > 0 ? { ...commit, refs, hiddenRefs: hidden } : { ...commit, refs };
}
