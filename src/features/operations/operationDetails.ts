import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../../log';
import type { RepoOperationDto, RepoOperationKind } from '../../shared/history/historyProtocol';

const log = createLogger('operation-details');

function read(gitDir: string, ...parts: string[]): string | undefined {
  try {
    return fs.readFileSync(path.join(gitDir, ...parts), 'utf8').trim() || undefined;
  } catch (error) {
    // Not there: this operation does not keep that file, or has not reached the step that writes it.
    log.debug(`no ${parts.join('/')} in the Git directory`, error);
    return undefined;
  }
}

const short = (hash: string | undefined): string | undefined => (hash ? hash.slice(0, 7) : undefined);

/** "refs/heads/main" is "main"; anything else (a detached rebase) is left as Git wrote it. */
export function branchFromRef(ref: string | undefined): string | undefined {
  return ref?.replace(/^refs\/heads\//, '');
}

type Details = Pick<RepoOperationDto, 'progress' | 'branch' | 'target' | 'commit'>;

/**
 * What the banner says about an operation in progress, read from the files Git keeps in the repository's
 * Git directory while it runs: which branch is being rebased onto what, how far it got, and which commit
 * it stopped on.
 */
export function readOperationDetails(gitDir: string, kind: RepoOperationKind): Details {
  switch (kind) {
    case 'rebase': {
      const dir = fs.existsSync(path.join(gitDir, 'rebase-merge')) ? 'rebase-merge' : 'rebase-apply';
      const merge = dir === 'rebase-merge';
      const step = Number.parseInt(read(gitDir, dir, merge ? 'msgnum' : 'next') ?? '', 10);
      const total = Number.parseInt(read(gitDir, dir, merge ? 'end' : 'last') ?? '', 10);
      return {
        branch: branchFromRef(read(gitDir, dir, 'head-name')),
        target: short(read(gitDir, dir, 'onto')),
        commit: short(read(gitDir, 'REBASE_HEAD')),
        ...(step > 0 && total > 0 ? { progress: { step: Math.min(step, total), total } } : {}),
      };
    }
    case 'merge':
      return { target: short(read(gitDir, 'MERGE_HEAD')) };
    case 'cherry-pick':
      return { target: short(read(gitDir, 'CHERRY_PICK_HEAD')) };
    case 'revert':
      return { target: short(read(gitDir, 'REVERT_HEAD')) };
    default:
      return {};
  }
}
