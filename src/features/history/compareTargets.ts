import * as l10n from '@vscode/l10n';
import type { GitCli } from '../../core/gitCli';
import { createLogger } from '../../log';

const log = createLogger('compare');

/** What a commit is compared with: the checked-out commit, the commit where it and HEAD diverged, the upstream of its branch, or a ref a person picked. */
export type CompareMode = 'head' | 'mergeBase' | 'upstream' | 'ref';

export type ResolvedCompare = { ok: true; base: string; head: string } | { ok: false; message: string };

async function revParse(cli: GitCli, revision: string): Promise<string | undefined> {
  // A revision that names nothing is an expected outcome: the caller says so.
  try {
    return (await cli.execRead(['rev-parse', '--verify', '--quiet', `${revision}^{commit}`])).stdout.trim() || undefined;
  } catch (error) {
    log.debug(`${revision} names no commit`, error);
    return undefined;
  }
}

/**
 * The two commits of a comparison, shown as what changed from `base` to `head`. `commit` is the one that was
 * right-clicked and is always the head, except when it is compared with HEAD, where it is the starting point.
 */
export async function resolveCompare(
  cli: GitCli,
  mode: CompareMode,
  commit: string,
  target?: string,
): Promise<ResolvedCompare> {
  const fail = (message: string): ResolvedCompare => ({ ok: false, message });
  if (target?.startsWith('-')) {
    return fail(l10n.t('Choose a branch, tag or commit to compare with.'));
  }
  switch (mode) {
    case 'head': {
      const head = await revParse(cli, 'HEAD');
      return head ? { ok: true, base: commit, head } : fail(l10n.t('There is no commit at HEAD to compare with.'));
    }
    case 'mergeBase': {
      let base: string | undefined;
      try {
        base = (await cli.execRead(['merge-base', 'HEAD', commit])).stdout.trim() || undefined;
      } catch (error) {
        log.debug(`HEAD and ${commit} have no merge base`, error);
      }
      return base ? { ok: true, base, head: commit } : fail(l10n.t('This commit and HEAD have no common ancestor.'));
    }
    case 'upstream': {
      const upstream = target ? await revParse(cli, `${target}@{upstream}`) : undefined;
      return upstream
        ? { ok: true, base: upstream, head: commit }
        : fail(l10n.t('{0} has no upstream branch to compare with.', target ?? ''));
    }
    case 'ref': {
      const base = target ? await revParse(cli, target) : undefined;
      return base ? { ok: true, base, head: commit } : fail(l10n.t('{0} is not a branch, tag or commit.', target ?? ''));
    }
  }
}
