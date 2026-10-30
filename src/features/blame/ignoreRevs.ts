import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** The file code hosts read to leave bulk changes, such as a reformat, out of blame. */
export const IGNORE_REVS_FILE = '.git-blame-ignore-revs';

/**
 * `git blame` skips the commits listed in `.git-blame-ignore-revs` only when told to; GitHub and others use the file
 * on their own, so this does the same. A repository can still name its own file with `blame.ignoreRevsFile`.
 */
export function ignoreRevsArgs(repoRoot: string, enabled: boolean): string[] {
  return enabled && existsSync(join(repoRoot, IGNORE_REVS_FILE)) ? ['--ignore-revs-file', IGNORE_REVS_FILE] : [];
}
