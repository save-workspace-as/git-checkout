import * as path from 'path';

import type { GitSubmoduleDto, SubmoduleCheckoutStatus } from '../../shared/submodules/submoduleProtocol';

const STATUS_LINE = /^([ +\-U])([0-9a-f]{40,64}) (.*)$/i;

const STATUS_BY_PREFIX: Record<string, SubmoduleCheckoutStatus> = {
  ' ': 'ok',
  '+': 'modified',
  '-': 'uninitialized',
  U: 'conflict',
};

/** Parses `git submodule status --recursive`. Skips lines that are not status rows. */
export function parseSubmoduleStatus(stdout: string, repoRoot: string): GitSubmoduleDto[] {
  const entries: GitSubmoduleDto[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line) {
      continue;
    }
    const match = STATUS_LINE.exec(line);
    if (!match) {
      continue;
    }
    const status = STATUS_BY_PREFIX[match[1]];
    if (!status) {
      continue;
    }
    const { path: relPath, describe } = splitPathAndDescribe(match[3]);
    if (!relPath) {
      continue;
    }
    entries.push({
      path: relPath,
      sha: match[2].toLowerCase(),
      describe,
      status,
      absolutePath: path.resolve(repoRoot, relPath),
    });
  }
  return entries;
}

/** Parses `git ls-files --stage` rows whose mode is a gitlink. */
export function parseGitlinkPaths(stdout: string): Set<string> {
  const paths = new Set<string>();
  for (const line of stdout.split(/\0|\r?\n/)) {
    const match = /^160000 [0-9a-f]+ \d+\t(.*)$/i.exec(line);
    if (match?.[1]) {
      paths.add(match[1]);
    }
  }
  return paths;
}

function splitPathAndDescribe(rest: string): { path: string; describe: string | null } {
  const described = /^(.*) \((.*)\)$/.exec(rest);
  if (!described) {
    return { path: rest, describe: null };
  }
  return { path: described[1], describe: described[2] };
}
