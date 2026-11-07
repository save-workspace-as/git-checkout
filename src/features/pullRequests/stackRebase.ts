import type { GitCli } from '../../core/gitCli';
import { createLogger } from '../../log';

const log = createLogger('stack-rebase');

/** What one layer needed: it was moved onto its parent, or it was on it already. */
export interface RebaseStep {
  branch: string;
  moved: boolean;
}

async function isAncestor(cli: GitCli, ancestor: string, descendant: string): Promise<boolean> {
  try {
    await cli.execRead(['merge-base', '--is-ancestor', ancestor, descendant]);
    return true;
  } catch (error) {
    // Exit status 1 is the answer "no"; a missing ref is an error the next command reports.
    log.debug(`${ancestor} is not an ancestor of ${descendant}`, error);
    return false;
  }
}

export interface StackRebaseLayers {
  /** The layers' local branches, bottom first. */
  branches: readonly string[];
  /** What the bottom layer is rebased onto: the base branch, such as `origin/main`. */
  trunk: string;
  /**
   * The branch the bottom layer was built on, when that is not the trunk: its pull request still targets a parent that was
   * merged. Only the commits after it move, so a squash-merged parent is not applied twice.
   */
  mergedParent?: string;
}

/**
 * Moves each layer of a stack onto its parent, bottom first: the bottom onto the trunk, the others onto the layer below
 * at its new tip. A layer that is on its parent already is left alone, so running it again after conflicts were resolved
 * carries on where it stopped. The commits that move are those after where the layer left the parent, found from the
 * parent's reflog, so a parent that was amended does not bring its old commits along.
 */
export async function rebaseStack(cli: GitCli, layers: StackRebaseLayers, options: { onStep?: (step: RebaseStep) => void } = {}): Promise<RebaseStep[]> {
  const steps: RebaseStep[] = [];
  for (const [index, branch] of layers.branches.entries()) {
    const parent = index === 0 ? layers.trunk : layers.branches[index - 1];
    if (await isAncestor(cli, parent, branch)) {
      steps.push({ branch, moved: false });
    } else {
      // The merged parent only counts while the layer is built on it; after it was rebased, the trunk is its parent.
      const upstream = index === 0 && layers.mergedParent && (await isAncestor(cli, layers.mergedParent, branch)) ? layers.mergedParent : undefined;
      await cli.execWrite(upstream ? ['rebase', '--onto', parent, upstream, branch] : ['rebase', '--fork-point', parent, branch]);
      steps.push({ branch, moved: true });
    }
    options.onStep?.(steps[steps.length - 1]);
  }
  return steps;
}
