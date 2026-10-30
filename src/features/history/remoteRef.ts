import { createLogger } from '../../log';

const log = createLogger('remote-link');

/**
 * What a link to a file should point at. The commit itself is best, since it never changes, but only when a remote has
 * it; one that is not pushed would be a link that does not open. Then the branch the work will be pushed to, the
 * upstream branch's name or else the current one, and a commit only when HEAD is detached.
 */
export async function remoteRef(cli: { execRead: (args: string[], options?: { showErrorToast?: boolean }) => Promise<{ stdout: string }> }): Promise<string> {
  const head = (await cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();
  const remotes = (await cli.execRead(['branch', '-r', '--contains', head, '--format=%(refname:short)'])).stdout
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().endsWith('/HEAD'));
  if (remotes.length > 0) {
    return head;
  }
  const upstream = await cli
    .execRead(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { showErrorToast: false })
    .then((result) => result.stdout.trim(), (error: unknown) => {
      // A branch with no upstream is common; the branch's own name is used.
      log.debug('no upstream branch', error);
      return '';
    });
  if (upstream.includes('/')) {
    return upstream.slice(upstream.indexOf('/') + 1);
  }
  const branch = await cli
    .execRead(['symbolic-ref', '--short', '-q', 'HEAD'], { showErrorToast: false })
    .then((result) => result.stdout.trim(), (error: unknown) => {
      // A detached HEAD has no branch name; the commit is the best there is.
      log.debug('no current branch', error);
      return '';
    });
  return branch || head;
}
