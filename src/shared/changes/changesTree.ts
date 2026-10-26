import { compareTreeEntries } from '../history/treeOrder';
import type { WorkingCopyDiffSide, WorkingCopyEntryDto } from './workingCopyProtocol';

/** The part of a change a command needs to act on it. */
export interface ChangeTarget {
  path: string;
  side: WorkingCopyDiffSide;
  untracked: boolean;
}

/**
 * A row in a Changes list. `webviewSection` and `path` let commands treat a file row like the
 * context that menus used before the lists were native.
 */
export interface ChangeFileNode extends ChangeTarget {
  kind: 'file';
  webviewSection: 'changesFile';
  /** Unique within the lists of one repository, so a refresh keeps the selection and open folders. */
  key: string;
  label: string;
  /** The folder a flat list shows after the name. */
  folder: string;
  status: WorkingCopyEntryDto['status'];
  originalPath?: string;
}

export interface ChangeDirNode {
  kind: 'dir';
  key: string;
  path: string;
  label: string;
  side: WorkingCopyDiffSide;
  children: ChangeNode[];
  /** Every change below, so a command on the folder covers them. */
  files: ChangeTarget[];
}

export type ChangeNode = ChangeFileNode | ChangeDirNode;

export const sideOfEntry = (entry: WorkingCopyEntryDto): WorkingCopyDiffSide =>
  entry.group === 'staged' ? 'staged' : 'unstaged';

export const changeKey = (side: WorkingCopyDiffSide, path: string): string => `${side}\0${path}`;

function fileNode(entry: WorkingCopyEntryDto, label?: string): ChangeFileNode {
  const side = sideOfEntry(entry);
  const clean = entry.path.replace(/\/+$/, '');
  const slash = clean.lastIndexOf('/');
  return {
    kind: 'file',
    webviewSection: 'changesFile',
    key: changeKey(side, entry.path),
    path: entry.path,
    side,
    untracked: entry.group === 'untracked',
    label: label ?? clean.slice(slash + 1),
    folder: slash < 0 ? '' : clean.slice(0, slash),
    status: entry.status,
    ...(entry.originalPath ? { originalPath: entry.originalPath } : {}),
  };
}

/** Changes as a flat list in the order given, or as folders-first trees of folders. */
export function buildChangeNodes(entries: readonly WorkingCopyEntryDto[], tree: boolean): ChangeNode[] {
  if (!tree) {
    return entries.map((entry) => fileNode(entry));
  }
  const roots: ChangeNode[] = [];
  const dirs = new Map<string, ChangeDirNode>();
  for (const entry of entries) {
    const parts = entry.path.split('/').filter(Boolean);
    let siblings = roots;
    let prefix = '';
    const owners: ChangeDirNode[] = [];
    for (let index = 0; index < parts.length - 1; index++) {
      prefix = prefix ? `${prefix}/${parts[index]}` : parts[index];
      let dir = dirs.get(prefix);
      if (!dir) {
        dir = { kind: 'dir', key: `dir\0${prefix}`, path: prefix, label: parts[index], side: sideOfEntry(entry), children: [], files: [] };
        dirs.set(prefix, dir);
        siblings.push(dir);
      }
      owners.push(dir);
      siblings = dir.children;
    }
    const file = fileNode(entry, parts[parts.length - 1] ?? entry.path);
    siblings.push(file);
    for (const dir of owners) {
      dir.files.push({ path: file.path, side: file.side, untracked: file.untracked });
    }
  }
  const sort = (nodes: ChangeNode[]): void => {
    nodes.sort((left, right) =>
      compareTreeEntries({ name: left.label, folder: left.kind === 'dir' }, { name: right.label, folder: right.kind === 'dir' }),
    );
    for (const node of nodes) {
      if (node.kind === 'dir') {
        sort(node.children);
      }
    }
  };
  sort(roots);
  return roots;
}

/** Every file in `nodes` with its folder, for finding a change by key. */
export function changeFiles(nodes: readonly ChangeNode[]): ChangeFileNode[] {
  return nodes.flatMap((node) => (node.kind === 'file' ? [node] : changeFiles(node.children)));
}

/** The changes a command covers: each selected file, and every file below a selected folder, once. */
export function changeTargets(nodes: readonly unknown[]): ChangeTarget[] {
  const seen = new Set<string>();
  const targets: ChangeTarget[] = [];
  const add = (target: ChangeTarget): void => {
    const key = changeKey(target.side, target.path);
    if (!seen.has(key)) {
      seen.add(key);
      targets.push({ path: target.path, side: target.side, untracked: target.untracked });
    }
  };
  for (const raw of nodes) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    const node = raw as { kind?: string; files?: ChangeTarget[]; path?: unknown; side?: unknown; untracked?: unknown };
    if (node.kind === 'dir' && Array.isArray(node.files)) {
      node.files.forEach(add);
    } else if (
      typeof node.path === 'string' && node.path &&
      (node.side === 'staged' || node.side === 'unstaged')
    ) {
      add({ path: node.path, side: node.side, untracked: node.untracked === true });
    }
  }
  return targets;
}

/**
 * The changes a Stage, Unstage, Discard or other Changes command covers. A menu hands over the row it was
 * opened on and then the whole selection; Enter in a list hands over nothing, so the list's own selection
 * stands in for it. With neither, there is nothing to act on.
 */
export function commandChangeTargets(
  arg: unknown,
  selected: unknown,
  listSelection: readonly unknown[] | undefined,
): ChangeTarget[] {
  const hasSelection = Array.isArray(selected) && selected.length > 0;
  if (arg === undefined && !hasSelection) {
    return changeTargets(listSelection ?? []);
  }
  return changeTargets(hasSelection ? (selected as unknown[]) : [arg]);
}
