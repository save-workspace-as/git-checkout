import type { GitCli } from '../../core/gitCli';
import { createLogger } from '../../log';

const log = createLogger('rebase-preflight');

export interface RiskyRevision {
  sha: string;
  conflictFiles: string[];
}

export interface RebasePreflightResult {
  riskyRevisions: RiskyRevision[];
}

async function checkReplayPreflight(
  cli: GitCli,
  onto: string,
  commit: string,
): Promise<{ wouldConflict: boolean; conflictFiles: string[]; nextTree: string | null }> {
  let base: string;
  try {
    base = (await cli.execRead(['merge-base', onto, commit])).stdout.trim();
  } catch (error) {
    log.debug(`could not find merge base for ${commit}`, error);
    return { wouldConflict: false, conflictFiles: [], nextTree: null };
  }

  try {
    const modern = await cli.execRead([
      'merge-tree',
      '--write-tree',
      `--merge-base=${base}`,
      onto,
      commit,
    ]);
    const conflictFiles = parseModernMergeTreeConflicts(modern.stdout);
    const nextTree = parseMergedTree(modern.stdout);
    return {
      wouldConflict: conflictFiles.length > 0,
      conflictFiles,
      nextTree,
    };
  } catch (error) {
    log.warn(`rebase preflight could not inspect ${commit}`, error);
    return { wouldConflict: false, conflictFiles: [], nextTree: null };
  }
}

export async function checkRebaseReplayPreflight(
  cli: GitCli,
  onto: string,
  commitShasOldestFirst: readonly string[],
): Promise<RebasePreflightResult> {
  const riskyRevisions: RiskyRevision[] = [];
  let simulated = onto;
  for (const sha of commitShasOldestFirst) {
    const result = await checkReplayPreflight(cli, simulated, sha);
    if (result.wouldConflict) {
      riskyRevisions.push({ sha, conflictFiles: result.conflictFiles });
    }
    if (result.nextTree) {
      simulated = result.nextTree;
    } else {
      simulated = sha;
    }
  }
  return { riskyRevisions };
}

function parseModernMergeTreeConflicts(output: string): string[] {
  const files: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /^CONFLICT \(.*\): (.+)$/.exec(line.trim());
    if (match) {
      files.push(match[1]);
    }
  }
  return [...new Set(files)];
}

function parseMergedTree(output: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*result\s+([0-9a-f]{40})\s*$/i.exec(line.trim());
    if (match) {
      return match[1];
    }
  }
  return null;
}
