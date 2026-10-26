import { autoStashMessage } from './autoStash';
import type { GitCli } from '../../core/gitCli';
import type { WorkingTreeService } from '../changes/workingTreeService';

export async function withLeanStash(
  repoRoot: string,
  enabled: boolean,
  workingTree: WorkingTreeService,
  cli: GitCli,
  fn: () => Promise<void>,
): Promise<void> {
  if (!enabled) {
    await fn();
    return;
  }

  const status = await workingTree.getStatus(repoRoot);
  if (!status.dirty) {
    await fn();
    return;
  }

  await cli.execWrite(['stash', 'push', '-m', autoStashMessage()], { showErrorToast: true });
  await fn();
  await cli.execWrite(['stash', 'pop'], { showErrorToast: true });
}
