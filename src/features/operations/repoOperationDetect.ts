import * as fs from 'fs';
import * as path from 'path';
import type { RepoOperationKind } from '../../shared/history/historyProtocol';

/** Filesystem markers for an in-progress git sequencer operation (see `git-checkout` issue #20). */
export function detectRepoOperationKind(gitDir: string): Exclude<RepoOperationKind, null> | null {
  if (fs.existsSync(path.join(gitDir, 'MERGE_HEAD'))) {
    return 'merge';
  }
  // REBASE_HEAD is not a marker: Git leaves it behind after a rebase that stopped and was then continued.
  if (fs.existsSync(path.join(gitDir, 'rebase-merge')) || fs.existsSync(path.join(gitDir, 'rebase-apply'))) {
    return 'rebase';
  }
  if (fs.existsSync(path.join(gitDir, 'CHERRY_PICK_HEAD'))) {
    return 'cherry-pick';
  }
  if (fs.existsSync(path.join(gitDir, 'REVERT_HEAD'))) {
    return 'revert';
  }
  if (fs.existsSync(path.join(gitDir, 'BISECT_LOG'))) {
    return 'bisect';
  }
  return null;
}
