import { compareTreeEntries } from './treeOrder';
import type { CommitTreePathContext } from './pathHistoryProtocol';

/** A file as a commit or a revision's tree lists it. */
export interface RevisionFile {
  path: string;
  /** `git diff-tree --name-status` token, for a commit's changed files. */
  status?: string;
  oldPath?: string;
}

export interface RevisionListOptions {
  revision: string;
  /** For a comparison, the older commit. */
  baseRevision?: string;
  list: 'changes' | 'tree';
  /** Folders, rather than a flat list. */
  tree: boolean;
}

/**
 * A row of a commit's changed files or a revision's file tree. It is also the context the file commands
 * run on, so a menu can hand the row straight to them.
 */
export type RevisionNode = (RevisionFileNode | RevisionDirNode) & CommitTreePathContext;

interface RevisionRow {
  key: string;
  label: string;
}

export interface RevisionFileNode extends RevisionRow {
  kind: 'file';
  /** The folder a flat list shows after the name. */
  folder: string;
  children?: undefined;
}

export interface RevisionDirNode extends RevisionRow {
  kind: 'dir';
  children: RevisionNode[];
}

function context(
  path: string,
  kind: 'blob' | 'tree',
  options: RevisionListOptions,
  file?: RevisionFile,
): CommitTreePathContext {
  return {
    webviewSection: 'commitTree',
    commitTreeKind: kind,
    path,
    revision: options.revision,
    list: options.list,
    ...(options.baseRevision ? { baseRevision: options.baseRevision } : {}),
    ...(file?.oldPath ? { oldPath: file.oldPath } : {}),
    ...(file?.status ? { status: file.status } : {}),
    preventDefaultContextMenuItems: true,
  };
}

function fileNode(file: RevisionFile, options: RevisionListOptions, label?: string): RevisionNode {
  const slash = file.path.lastIndexOf('/');
  return {
    kind: 'file',
    key: `file\0${file.path}`,
    label: label ?? file.path.slice(slash + 1),
    folder: slash < 0 ? '' : file.path.slice(0, slash),
    ...context(file.path, 'blob', options, file),
  };
}

/** The files as a flat list in the order given, or as folders-first trees of folders. */
export function buildRevisionNodes(files: readonly RevisionFile[], options: RevisionListOptions): RevisionNode[] {
  if (!options.tree) {
    return files.map((file) => fileNode(file, options));
  }
  const roots: RevisionNode[] = [];
  const dirs = new Map<string, RevisionNode & { children: RevisionNode[] }>();
  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    let siblings = roots;
    let prefix = '';
    for (let index = 0; index < parts.length - 1; index++) {
      prefix = prefix ? `${prefix}/${parts[index]}` : parts[index];
      let dir = dirs.get(prefix);
      if (!dir) {
        dir = { kind: 'dir', key: `dir\0${prefix}`, label: parts[index], children: [], ...context(prefix, 'tree', options) };
        dirs.set(prefix, dir);
        siblings.push(dir);
      }
      siblings = dir.children;
    }
    siblings.push(fileNode(file, options, parts[parts.length - 1] ?? file.path));
  }
  const sort = (nodes: RevisionNode[]): void => {
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

/** The key of a file in the list, for selecting it. */
export const revisionFileKey = (path: string): string => `file\0${path}`;

/** The paths of the files a command covers: the selected rows, with a folder standing for its files. */
export function revisionPaths(nodes: readonly unknown[]): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  const add = (node: unknown): void => {
    const row = node as { kind?: string; path?: unknown; commitTreeKind?: string; children?: unknown[] } | null;
    if (!row || typeof row !== 'object') {
      return;
    }
    if (row.kind === 'dir' && Array.isArray(row.children)) {
      row.children.forEach(add);
    } else if (typeof row.path === 'string' && row.path && !seen.has(row.path)) {
      seen.add(row.path);
      paths.push(row.path);
    }
  };
  nodes.forEach(add);
  return paths;
}
