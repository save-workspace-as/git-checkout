import * as l10n from '@vscode/l10n';
import type {
  ConflictFileDto,
  ConflictFileKind,
  ConflictScenario,
} from '../../shared/conflicts/conflictProtocol';
import type { RepoOperationKind } from '../../shared/history/historyProtocol';

export interface UnmergedPorcelainEntry {
  xy: string;
  path: string;
}

/** Parses `git status --porcelain=v2 -z` unmerged (`u`) records. */
export function parsePorcelainV2Unmerged(output: string): UnmergedPorcelainEntry[] {
  const entries: UnmergedPorcelainEntry[] = [];
  for (const record of output.split('\0')) {
    if (!record || record[0] !== 'u') {
      continue;
    }
    const parts = record.split(' ');
    if (parts.length < 11) {
      continue;
    }
    const xy = parts[1] ?? '';
    const path = parts.slice(10).join(' ');
    if (!path || xy.length < 2) {
      continue;
    }
    entries.push({ xy, path });
  }
  return entries;
}

export interface LsFilesStage {
  mode: string;
  stage: number;
}

/** Parses `git ls-files -u` lines: `<mode> <sha> <stage>\t<path>`. */
export function parseLsFilesUnmerged(output: string): Map<string, LsFilesStage[]> {
  const byPath = new Map<string, LsFilesStage[]>();
  for (const line of output.split(/\r?\n/)) {
    const tab = line.indexOf('\t');
    if (tab < 0) {
      continue;
    }
    const head = line.slice(0, tab);
    const path = line.slice(tab + 1).replace(/\\/g, '/');
    const [mode, , stageRaw] = head.split(' ');
    const stage = Number(stageRaw);
    if (!path || !mode || !Number.isFinite(stage)) {
      continue;
    }
    const list = byPath.get(path) ?? [];
    list.push({ mode, stage });
    byPath.set(path, list);
  }
  return byPath;
}

export function scenarioFromPorcelainXy(xy: string): ConflictScenario {
  const code = xy.toUpperCase();
  switch (code) {
    case 'UU':
      return 'both-modified';
    case 'AA':
      return 'both-added';
    case 'DD':
      return 'both-deleted';
    case 'DU':
      return 'deleted-by-us';
    case 'UD':
      return 'deleted-by-them';
    case 'AU':
      return 'added-by-us';
    case 'UA':
      return 'added-by-them';
    default:
      return 'both-modified';
  }
}

export function isDeletedVsModified(scenario: ConflictScenario): boolean {
  return scenario === 'deleted-by-us' || scenario === 'deleted-by-them';
}

export function kindFromStages(stages: LsFilesStage[] | undefined, binaryPaths: Set<string>, path: string): ConflictFileKind {
  if (stages?.some((s) => s.mode === '160000')) {
    return 'submodule';
  }
  if (binaryPaths.has(path)) {
    return 'binary';
  }
  return 'text';
}

export function badgeForKind(kind: ConflictFileKind): string {
  switch (kind) {
    case 'text':
      return 'text';
    case 'binary':
      return 'binary';
    case 'submodule':
      return 'submodule';
  }
}

export function guidanceForConflict(
  scenario: ConflictScenario,
  kind: ConflictFileKind,
  path: string,
): string {
  if (kind === 'submodule') {
    return l10n.t(
      'Submodule conflict in "{0}". Checkout the intended commit inside the submodule, then run `git add {0}`. Do not auto-resolve submodule pointers.',
      path,
    );
  }
  if (isDeletedVsModified(scenario)) {
    if (scenario === 'deleted-by-us') {
      return l10n.t(
        '"{0}" was deleted on your branch but modified on the other side. Keep the file with `git add {0}` or keep the deletion with `git rm {0}`.',
        path,
      );
    }
    return l10n.t(
      '"{0}" was modified on your branch but deleted on the other side. Keep your version with `git add {0}` or accept deletion with `git rm {0}`.',
      path,
    );
  }
  if (scenario === 'both-deleted') {
    return l10n.t('"{0}" was deleted on both sides. Run `git rm {0}` to record the deletion.', path);
  }
  if (kind === 'binary') {
    return l10n.t(
      'Binary conflict in "{0}". Choose a version with `git checkout --ours {0}` or `git checkout --theirs {0}`, then `git add {0}`. The merge editor cannot merge binary blobs.',
      path,
    );
  }
  return l10n.t(
    'Resolve content in the 3-way merge editor, then save and stage with `git add {0}`.',
    path,
  );
}

export function mergeEditorSupported(scenario: ConflictScenario, kind: ConflictFileKind): boolean {
  if (kind !== 'text') {
    return false;
  }
  return !isDeletedVsModified(scenario) && scenario !== 'both-deleted';
}

export function buildConflictFile(
  path: string,
  xy: string,
  stages: LsFilesStage[] | undefined,
  binaryPaths: Set<string>,
): ConflictFileDto {
  const scenario = scenarioFromPorcelainXy(xy);
  const kind = kindFromStages(stages, binaryPaths, path);
  return {
    path,
    scenario,
    kind,
    badge: badgeForKind(kind),
    guidance: guidanceForConflict(scenario, kind, path),
    mergeEditorSupported: mergeEditorSupported(scenario, kind),
  };
}

export function buildConflictFiles(
  porcelain: string,
  lsFiles: string,
  binaryPaths: Iterable<string> = [],
): ConflictFileDto[] {
  const binarySet = new Set(binaryPaths);
  const stagesByPath = parseLsFilesUnmerged(lsFiles);
  const entries = parsePorcelainV2Unmerged(porcelain);
  const files = entries.map((entry) =>
    buildConflictFile(entry.path, entry.xy, stagesByPath.get(entry.path), binarySet),
  );
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function continueGitCommand(kind: RepoOperationKind): string {
  switch (kind) {
    case 'merge':
      return 'git merge --continue';
    case 'rebase':
      return 'git rebase --continue';
    case 'cherry-pick':
      return 'git cherry-pick --continue';
    case 'revert':
      return 'git revert --continue';
    default:
      return 'git commit';
  }
}

export function abortGitCommand(kind: RepoOperationKind): string {
  switch (kind) {
    case 'merge':
      return 'git merge --abort';
    case 'rebase':
      return 'git rebase --abort';
    case 'cherry-pick':
      return 'git cherry-pick --abort';
    case 'revert':
      return 'git revert --abort';
    default:
      return 'git merge --abort';
  }
}

export function wrapConflictIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  const mod = index % length;
  return mod < 0 ? mod + length : mod;
}
