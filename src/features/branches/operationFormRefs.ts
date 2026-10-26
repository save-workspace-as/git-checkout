import type { GitCli } from '../../core/gitCli';

export async function listOperationRefs(cli: GitCli, current: string): Promise<string[]> {
  const result = await cli.execRead([
    'for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes', 'refs/tags',
  ]);
  const refs = result.stdout.split(/\r?\n/).filter((ref) => ref && !ref.endsWith('/HEAD'));
  return [...new Set([current.trim(), 'HEAD', ...refs].filter(Boolean))];
}
