import type { GitCli } from '../../core/gitCli';
import { createLogger } from '../../log';

const log = createLogger('merge-preflight');

export interface MergePreflightResult {
  wouldConflict: boolean;
  conflictFiles: string[];
}

export async function checkMergePreflight(cli: GitCli, ref: string): Promise<MergePreflightResult> {
  let base: string;
  try {
    base = (await cli.execRead(['merge-base', 'HEAD', ref])).stdout.trim();
  } catch (error) {
    log.debug(`could not find merge base for ${ref}`, error);
    return { wouldConflict: false, conflictFiles: [] };
  }

  try {
    const modern = await cli.execRead([
      'merge-tree',
      '--write-tree',
      `--merge-base=${base}`,
      'HEAD',
      ref,
    ]);
    const conflictFiles = parseModernMergeTreeConflicts(modern.stdout);
    return { wouldConflict: conflictFiles.length > 0, conflictFiles };
  } catch (modernError) {
    log.debug('merge-tree with explicit merge base failed', modernError);
    try {
      const modernLegacy = await cli.execRead(['merge-tree', '--write-tree', base, 'HEAD', ref]);
      const conflictFiles = parseModernMergeTreeConflicts(modernLegacy.stdout);
      return { wouldConflict: conflictFiles.length > 0, conflictFiles };
    } catch (modernLegacyError) {
      log.debug('merge-tree with positional merge base failed', modernLegacyError);
      try {
        const classic = await cli.execRead(['merge-tree', base, 'HEAD', ref]);
        const conflictFiles = parseClassicMergeTreeConflicts(classic.stdout);
        return { wouldConflict: conflictFiles.length > 0, conflictFiles };
      } catch (classicError) {
        log.warn(`merge preflight could not inspect ${ref}`, classicError);
        return { wouldConflict: false, conflictFiles: [] };
      }
    }
  }
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

const CLASSIC_MERGE_STAGE_PATH =
  /^\s*(?:base|our|their)\s+\d+\s+[0-9a-f]+\s+(.+)$/i;

function parseClassicMergeTreeConflicts(output: string): string[] {
  const files: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    const inline = /^(?:changed in both|CONFLICT).*?:?\s*(.+)$/.exec(trimmed);
    if (inline) {
      files.push(inline[1].trim());
      continue;
    }
    const stage = CLASSIC_MERGE_STAGE_PATH.exec(line);
    if (stage) {
      files.push(stage[1].trim());
    }
  }
  return [...new Set(files)].filter(Boolean);
}
