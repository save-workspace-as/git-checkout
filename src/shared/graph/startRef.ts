import type { GraphRefDto } from './graphProtocol';

/**
 * A name for a commit to start something from, preferred over its hash: the checked-out branch, then
 * another local branch, a remote branch, and a tag. A commit with none of them has no name.
 */
export function preferredStartRef(refs: readonly Pick<GraphRefDto, 'kind' | 'name' | 'isHead'>[]): string | undefined {
  return (
    refs.find((ref) => ref.kind === 'local' && ref.isHead) ??
    refs.find((ref) => ref.kind === 'local') ??
    refs.find((ref) => ref.kind === 'remote') ??
    refs.find((ref) => ref.kind === 'tag')
  )?.name;
}
