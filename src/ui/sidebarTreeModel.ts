import * as l10n from '@vscode/l10n';
import type { WorktreeStatusDto } from '../shared/changes/dailyGitProtocol';
import type {
    RefBranchDto,
    RefRemoteBranchDto,
    RefsSnapshotDto,
    RefTagDto,
} from '../shared/branches/refsProtocol';
import type { GitSubmoduleDto, SubmoduleCheckoutStatus } from '../shared/submodules/submoduleProtocol';
import { stashDropOrder, type StashEntryDto } from '../shared/stash/stashProtocol';
import { worktreeBranchLabel, type GitWorktreeDto } from '../shared/worktrees/worktreeProtocol';

export const SIDEBAR_VIEW_ID = 'gitCheckout.sidebar';
/**
 * Each repository gets its own collapsible view. Extensions cannot add views at runtime, so this
 * many are declared in package.json and shown while `gitCheckout.sidebarRepoCount` exceeds the slot.
 */
export const SIDEBAR_REPO_SLOTS = 8;

export function sidebarViewId(slot: number): string {
  return slot === 0 ? SIDEBAR_VIEW_ID : `${SIDEBAR_VIEW_ID}.${slot}`;
}
export const SIDEBAR_DRAG_MIME = `application/vnd.code.tree.${SIDEBAR_VIEW_ID.toLowerCase()}`;

export const SIDEBAR_COMMANDS = {
  revealInGraph: 'gitCheckout.sidebar.revealInGraph',
  showLocalChanges: 'gitCheckout.sidebar.showLocalChanges',
  showAllCommits: 'gitCheckout.sidebar.showAllCommits',
  search: 'gitCheckout.sidebar.search',
  clearSearch: 'gitCheckout.sidebar.clearSearch',
  checkout: 'gitCheckout.sidebar.checkout',
  checkoutTag: 'gitCheckout.sidebar.checkoutTag',
  checkoutAsWorktree: 'gitCheckout.sidebar.checkoutAsWorktree',
  fastForward: 'gitCheckout.sidebar.fastForward',
  pullBranch: 'gitCheckout.sidebar.pullBranch',
  pushBranch: 'gitCheckout.sidebar.pushBranch',
  openPullRequest: 'gitCheckout.sidebar.openPullRequest',
  fetchRemote: 'gitCheckout.sidebar.fetchRemote',
  merge: 'gitCheckout.sidebar.merge',
  rebase: 'gitCheckout.sidebar.rebase',
  interactiveRebaseTag: 'gitCheckout.sidebar.interactiveRebaseTag',
  showTagDetails: 'gitCheckout.sidebar.showTagDetails',
  pushTag: 'gitCheckout.sidebar.pushTag',
  setUpstream: 'gitCheckout.sidebar.setUpstream',
  unsetUpstream: 'gitCheckout.sidebar.unsetUpstream',
  renameBranch: 'gitCheckout.sidebar.renameBranch',
  deleteBranch: 'gitCheckout.sidebar.deleteBranch',
  createBranch: 'gitCheckout.sidebar.createBranch',
  compareBranches: 'gitCheckout.sidebar.compareBranches',
  copyBranchName: 'gitCheckout.sidebar.copyBranchName',
  copyTagName: 'gitCheckout.sidebar.copyTagName',
  createTag: 'gitCheckout.sidebar.createTag',
  createTagLight: 'gitCheckout.sidebar.createTagLight',
  createTagAnnotated: 'gitCheckout.sidebar.createTagAnnotated',
  deleteTag: 'gitCheckout.sidebar.deleteTag',
  addRemote: 'gitCheckout.sidebar.addRemote',
  editRemote: 'gitCheckout.sidebar.editRemote',
  openRemote: 'gitCheckout.sidebar.openRemote',
  removeRemote: 'gitCheckout.sidebar.removeRemote',
  createStash: 'gitCheckout.sidebar.createStash',
  clearStashes: 'gitCheckout.sidebar.clearStashes',
  applyStash: 'gitCheckout.sidebar.applyStash',
  popStash: 'gitCheckout.sidebar.popStash',
  dropStash: 'gitCheckout.sidebar.dropStash',
  showStash: 'gitCheckout.sidebar.showStash',
  renameStash: 'gitCheckout.sidebar.renameStash',
  saveStashPatch: 'gitCheckout.sidebar.saveStashPatch',
  createWorktree: 'gitCheckout.sidebar.createWorktree',
  openWorktree: 'gitCheckout.sidebar.openWorktree',
  copyWorktreePath: 'gitCheckout.sidebar.copyWorktreePath',
  revealWorktree: 'gitCheckout.sidebar.revealWorktree',
  deleteWorktree: 'gitCheckout.sidebar.deleteWorktree',
  addSubmodule: 'gitCheckout.sidebar.addSubmodule',
  initSubmodules: 'gitCheckout.sidebar.initSubmodules',
  updateSubmodules: 'gitCheckout.sidebar.updateSubmodules',
  syncSubmodules: 'gitCheckout.sidebar.syncSubmodules',
  initSubmodule: 'gitCheckout.sidebar.initSubmodule',
  updateSubmodule: 'gitCheckout.sidebar.updateSubmodule',
  syncSubmodule: 'gitCheckout.sidebar.syncSubmodule',
  openSubmodule: 'gitCheckout.sidebar.openSubmodule',
  copySubmodulePath: 'gitCheckout.sidebar.copySubmodulePath',
  openSubmoduleInTerminal: 'gitCheckout.sidebar.openSubmoduleInTerminal',
  revealSubmodule: 'gitCheckout.sidebar.revealSubmodule',
  deleteSubmodule: 'gitCheckout.sidebar.deleteSubmodule',
  showSubmoduleDiff: 'gitCheckout.sidebar.showSubmoduleDiff',
} as const;

export const SIDEBAR_CONTEXT = {
  localChanges: 'localChanges',
  allCommits: 'allCommits',
  branchesSection: 'section.branches',
  remotesSection: 'section.remotes',
  tagsSection: 'section.tags',
  folder: 'folder',
  localBranch: 'branch.local',
  trackedLocalBranch: 'branch.local.tracked',
  headBranch: 'branch.local.head',
  trackedHeadBranch: 'branch.local.head.tracked',
  remote: 'remote',
  remoteBranch: 'branch.remote',
  tag: 'tag',
  stashesSection: 'section.stashes',
  stash: 'stash',
  worktreesSection: 'section.worktrees',
  pullRequestsSection: 'section.pullRequests',
  pullRequestCategory: 'pullRequests.category',
  pullRequest: 'pullRequest',
  pullRequestAction: 'pullRequests.action',
  worktree: 'worktree',
  worktreeCurrent: 'worktree.current',
  submodulesSection: 'section.submodules',
  submodule: 'submodule',
  submoduleModified: 'submodule.modified',
  submoduleUninitialized: 'submodule.uninitialized',
  submoduleConflict: 'submodule.conflict',
  message: 'message',
} as const;

export type SidebarNodeKind =
  | 'localChanges'
  | 'allCommits'
  | 'section'
  | 'folder'
  | 'branch'
  | 'remote'
  | 'remoteBranch'
  | 'tag'
  | 'stash'
  | 'worktree'
  | 'submodule'
  | 'pullRequest'
  | 'message';

export interface SidebarNode {
  id: string;
  kind: SidebarNodeKind;
  label: string;
  contextValue: string;
  description?: string;
  tooltip?: string;
  /** Full ref name for branches and tags; remote name for remotes. */
  ref?: string;
  isHead?: boolean;
  /** Local branch checked out in a worktree other than this window. */
  checkedOutElsewhere?: boolean;
  /** Present when a search result should stay open. */
  expanded?: boolean;
  /** Root of the repository this row belongs to. */
  repoRoot?: string;
  /** A codicon for the row, instead of the one its kind has, with a theme color id for it. */
  icon?: { id: string; color?: string };
  /** What a click on the row runs, instead of what its kind does. */
  command?: { id: string; args?: unknown[] };
  children: SidebarNode[];
}

export type SidebarCollapsible = 'none' | 'collapsed' | 'expanded';

export interface SidebarTreeItemSpec {
  label: string;
  description?: string;
  tooltip?: string;
  contextValue: string;
  icon?: string;
  /** VS Code theme color id for {@link icon}, when set. */
  iconColor?: string;
  collapsible: SidebarCollapsible;
  command?: { id: string; args: unknown[] };
}

export function repositoryBranchLabel(headRef: string | null): string | undefined {
  if (!headRef) {
    return undefined;
  }
  const prefix = 'refs/heads/';
  return headRef.startsWith(prefix) ? headRef.slice(prefix.length) : headRef;
}

/** Tags a row and everything below it with the repository it belongs to. */
export function assignRepoRoot(node: SidebarNode, repoRoot: string): void {
  node.repoRoot = repoRoot;
  for (const child of node.children) {
    assignRepoRoot(child, repoRoot);
  }
}

export function formatUpstreamTrack(track: string | null): string {
  if (!track) {
    return '';
  }
  if (/\bgone\b/.test(track)) {
    return 'gone';
  }
  const behind = /behind (\d+)/.exec(track)?.[1];
  const ahead = /ahead (\d+)/.exec(track)?.[1];
  return [behind ? `${behind}↓` : '', ahead ? `${ahead}↑` : ''].filter(Boolean).join(' ');
}

export function buildSidebarTree(
  snapshot: RefsSnapshotDto,
  worktree: WorktreeStatusDto,
  stashes: readonly StashEntryDto[] = [],
  gitWorktrees: readonly GitWorktreeDto[] = [],
  submodules: readonly GitSubmoduleDto[] = [],
  /** The Pull Requests section, when there is one to show. */
  pullRequests?: SidebarNode,
): SidebarNode[] {
  const changedCount = worktree.stagedCount + worktree.unstagedCount;
  const elsewhere = elsewhereByBranch(gitWorktrees);
  return [
    {
      id: 'localChanges',
      kind: 'localChanges',
      label: l10n.t('Changes'),
      contextValue: SIDEBAR_CONTEXT.localChanges,
      description: changedCount > 0 ? String(changedCount) : undefined,
      children: [],
    },
    {
      id: 'allCommits',
      kind: 'allCommits',
      label: l10n.t('History'),
      contextValue: SIDEBAR_CONTEXT.allCommits,
      children: [],
    },
    {
      id: 'section:branches',
      kind: 'section',
      label: l10n.t('Branches'),
      contextValue: SIDEBAR_CONTEXT.branchesSection,
      children: nestByPath(
        snapshot.branches.map((branch) => ({
          path: branch.name,
          node: branchNode(branch, elsewhere.get(branch.name)),
        })),
        'branches',
      ),
    },
    {
      id: 'section:remotes',
      kind: 'section',
      label: l10n.t('Remotes'),
      contextValue: SIDEBAR_CONTEXT.remotesSection,
      children: remoteNodes(snapshot),
    },
    ...(pullRequests ? [pullRequests] : []),
    {
      id: 'section:tags',
      kind: 'section',
      label: l10n.t('Tags'),
      contextValue: SIDEBAR_CONTEXT.tagsSection,
      children: snapshot.tags.map(tagNode),
    },
    {
      id: 'section:stashes',
      kind: 'section',
      label: l10n.t('Stashes'),
      contextValue: SIDEBAR_CONTEXT.stashesSection,
      description: stashes.length > 0 ? String(stashes.length) : undefined,
      children:
        stashes.length > 0
          ? stashes.map(stashNode)
          : [
              {
                id: 'message:stashes',
                kind: 'message',
                label: l10n.t('No stashes'),
                contextValue: SIDEBAR_CONTEXT.message,
                children: [],
              },
            ],
    },
    {
      id: 'section:worktrees',
      kind: 'section',
      label: l10n.t('Worktrees'),
      contextValue: SIDEBAR_CONTEXT.worktreesSection,
      description: gitWorktrees.length > 0 ? String(gitWorktrees.length) : undefined,
      children: worktreeSectionChildren(gitWorktrees),
    },
    {
      id: 'section:submodules',
      kind: 'section',
      label: l10n.t('Submodules'),
      contextValue: SIDEBAR_CONTEXT.submodulesSection,
      description: submodules.length > 0 ? String(submodules.length) : undefined,
      children: submoduleSectionChildren(submodules),
    },
  ];
}

/** A query filters the sections below History. */
export function withSidebarSearch(nodes: readonly SidebarNode[], query: string): SidebarNode[] {
  const needle = query.trim();
  if (!needle) {
    return [...nodes];
  }
  const allIndex = nodes.findIndex((node) => node.kind === 'allCommits');
  const splitAt = allIndex >= 0 ? allIndex + 1 : 0;
  const head = nodes.slice(0, splitAt);
  const tail = nodes.slice(splitAt);
  const tokens = needle.toLowerCase().split(/\s+/);
  const filteredTail = filterNodes(tail, tokens);
  return [...head, ...(filteredTail.length > 0 ? [] : [noMatchesNode(needle)]), ...filteredTail];
}

function noMatchesNode(query: string): SidebarNode {
  return {
    id: 'message:search',
    kind: 'message',
    label: l10n.t('No matches'),
    tooltip: l10n.t('Nothing in this repository matches "{0}"', query),
    contextValue: SIDEBAR_CONTEXT.message,
    children: [],
  };
}

function filterNodes(nodes: readonly SidebarNode[], tokens: readonly string[]): SidebarNode[] {
  return nodes.flatMap((node) => {
    const filtered = filterNode(node, tokens);
    return filtered ? [filtered] : [];
  });
}

function filterNode(node: SidebarNode, tokens: readonly string[]): SidebarNode | null {
  if (node.kind === 'message') {
    return null;
  }
  const children = filterNodes(node.children, tokens);
  if (node.kind === 'section') {
    return children.length > 0 ? reveal(node, children) : null;
  }
  if (node.kind === 'folder' || node.kind === 'remote' || node.kind === 'submodule') {
    if (matchesQuery(node, tokens)) {
      return node.children.length > 0 ? { ...node, expanded: true } : node;
    }
    return children.length > 0 ? reveal(node, children) : null;
  }
  return matchesQuery(node, tokens) ? node : null;
}

function reveal(node: SidebarNode, children: SidebarNode[]): SidebarNode {
  return { ...node, children, expanded: true };
}

function matchesQuery(node: SidebarNode, tokens: readonly string[]): boolean {
  const haystack = [node.label, node.description, node.ref, node.tooltip]
    .filter((part) => part)
    .join('\n')
    .toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

export function sidebarMessageNode(message: string): SidebarNode {
  return {
    id: 'message',
    kind: 'message',
    label: message,
    contextValue: SIDEBAR_CONTEXT.message,
    children: [],
  };
}

export function treeItemSpec(node: SidebarNode): SidebarTreeItemSpec {
  const spec: SidebarTreeItemSpec = {
    label: node.label,
    description: node.description,
    tooltip: node.tooltip,
    contextValue: node.contextValue,
    icon: nodeIcon(node),
    collapsible: nodeCollapsible(node),
  };
  if (node.icon) {
    spec.icon = node.icon.id;
    spec.iconColor = node.icon.color;
  }
  const commandId = clickCommand(node);
  if (node.command) {
    spec.command = { id: node.command.id, args: node.command.args ?? [node] };
  } else if (commandId) {
    spec.command = { id: commandId, args: [node] };
  }
  return spec;
}

/** Returns [base, compare] when exactly two local branches are selected. */
export function pickCompareBranches(
  clicked: SidebarNode | undefined,
  selected: readonly SidebarNode[] | undefined,
): [string, string] | null {
  const nodes = selected && selected.length > 0 ? selected : clicked ? [clicked] : [];
  const refs = nodes.filter((n) => n.kind === 'branch' && n.ref).map((n) => n.ref as string);
  return refs.length === 2 && nodes.length === 2 ? [refs[0], refs[1]] : null;
}

/** Stash selectors from a multi-selection, highest index first. Mixed selections use the clicked stash. */
export function pickStashSelectors(
  clicked: SidebarNode | undefined,
  selected: readonly SidebarNode[] | undefined,
): string[] {
  const nodes = selected && selected.length > 0 ? [...selected] : clicked ? [clicked] : [];
  const stashes = nodes.filter((node) => node.kind === 'stash' && node.ref);
  const chosen =
    stashes.length === nodes.length
      ? stashes
      : clicked?.kind === 'stash' && clicked.ref
        ? [clicked]
        : [];
  return stashDropOrder(chosen.map((node) => node.ref as string));
}

/** Submodule paths from a multi-selection. Mixed selections use the clicked submodule. */
export function pickSubmodulePaths(
  clicked: SidebarNode | undefined,
  selected: readonly SidebarNode[] | undefined,
): string[] {
  const nodes = selected && selected.length > 0 ? [...selected] : clicked ? [clicked] : [];
  const submodules = nodes.filter((node) => node.kind === 'submodule' && node.ref);
  const chosen =
    submodules.length === nodes.length
      ? submodules
      : clicked?.kind === 'submodule' && clicked.ref
        ? [clicked]
        : [];
  return chosen.map((node) => node.ref as string);
}

export function dropIntent(
  sources: readonly SidebarNode[],
  target: SidebarNode | undefined,
): { source: string; target: string } | null {
  if (sources.length !== 1 || !target) {
    return null;
  }
  const [source] = sources;
  if (source.kind !== 'branch' || target.kind !== 'branch' || !source.ref || !target.ref) {
    return null;
  }
  if (source.ref === target.ref) {
    return null;
  }
  return { source: source.ref, target: target.ref };
}

function branchNode(branch: RefBranchDto, elsewherePath: string | undefined): SidebarNode {
  const checkedOutElsewhere = Boolean(elsewherePath) && !branch.isHead;
  const tooltip = [
    `${branch.name} · ${branch.shortSha}`,
    branch.upstream
      ? l10n.t('Upstream: {0} {1}', branch.upstream, branch.upstreamTrack ?? '').trim()
      : '',
    checkedOutElsewhere ? l10n.t('Checked out in {0}', elsewherePath ?? '') : '',
  ]
    .filter(Boolean)
    .join('\n');
  const track = formatUpstreamTrack(branch.upstreamTrack);
  return {
    id: `branch:${branch.name}`,
    kind: 'branch',
    label: leafName(branch.name),
    contextValue: branch.isHead
      ? branch.upstream
        ? SIDEBAR_CONTEXT.trackedHeadBranch
        : SIDEBAR_CONTEXT.headBranch
      : branch.upstream
        ? SIDEBAR_CONTEXT.trackedLocalBranch
        : SIDEBAR_CONTEXT.localBranch,
    description: track || (checkedOutElsewhere ? l10n.t('checked out') : undefined),
    tooltip,
    ref: branch.name,
    isHead: branch.isHead,
    checkedOutElsewhere,
    children: [],
  };
}

function elsewhereByBranch(worktrees: readonly GitWorktreeDto[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of worktrees) {
    if (entry.current || !entry.branch?.startsWith('refs/heads/')) {
      continue;
    }
    map.set(entry.branch.slice('refs/heads/'.length), entry.path);
  }
  return map;
}

function worktreeSectionChildren(worktrees: readonly GitWorktreeDto[]): SidebarNode[] {
  if (worktrees.length === 0) {
    return [
      {
        id: 'message:worktrees',
        kind: 'message',
        label: l10n.t('No worktrees'),
        contextValue: SIDEBAR_CONTEXT.message,
        children: [],
      },
    ];
  }
  return [...worktrees]
    .sort(
      (a, b) =>
        Number(b.current) - Number(a.current) ||
        compareNames(worktreeBranchLabel(a), worktreeBranchLabel(b)),
    )
    .map(worktreeNode);
}

function submoduleSectionChildren(submodules: readonly GitSubmoduleDto[]): SidebarNode[] {
  if (submodules.length === 0) {
    return [
      {
        id: 'message:submodules',
        kind: 'message',
        label: l10n.t('No submodules'),
        contextValue: SIDEBAR_CONTEXT.message,
        children: [],
      },
    ];
  }
  const paths = new Set(submodules.map((entry) => entry.path));
  const byPath = new Map(submodules.map((entry) => [entry.path, entry]));
  const build = (parent: string | null): SidebarNode[] => {
    const prefix = parent ? `${parent}/` : '';
    const direct = [...paths].filter((candidate) => {
      if (!candidate.startsWith(prefix)) {
        return false;
      }
      return ![...paths].some(
        (other) => other !== candidate && other.startsWith(prefix) && candidate.startsWith(`${other}/`),
      );
    });
    return direct
      .map((candidate) => {
        const entry = byPath.get(candidate);
        return entry ? submoduleNode(entry, parent, build(candidate)) : null;
      })
      .filter((node): node is SidebarNode => node !== null)
      .sort((a, b) => compareNames(a.label, b.label));
  };
  return build(null);
}

function submoduleNode(
  entry: GitSubmoduleDto,
  parent: string | null,
  children: SidebarNode[],
): SidebarNode {
  const relative = parent ? entry.path.slice(parent.length + 1) : entry.path;
  const short = entry.sha.slice(0, 7);
  return {
    id: `submodule:${entry.path}`,
    kind: 'submodule',
    label: relative,
    contextValue: submoduleContext(entry.status),
    description: submoduleDescription(entry.status, short),
    tooltip: [entry.path, entry.absolutePath, entry.sha, entry.describe ?? '', statusLabel(entry.status)]
      .filter(Boolean)
      .join('\n'),
    ref: entry.path,
    children,
  };
}

function submoduleContext(status: SubmoduleCheckoutStatus): string {
  switch (status) {
    case 'modified':
      return SIDEBAR_CONTEXT.submoduleModified;
    case 'uninitialized':
      return SIDEBAR_CONTEXT.submoduleUninitialized;
    case 'conflict':
      return SIDEBAR_CONTEXT.submoduleConflict;
    default:
      return SIDEBAR_CONTEXT.submodule;
  }
}

function submoduleDescription(status: SubmoduleCheckoutStatus, short: string): string {
  switch (status) {
    case 'uninitialized':
      return l10n.t('not initialized');
    case 'conflict':
      return l10n.t('conflict');
    case 'modified':
      return `+${short}`;
    default:
      return short;
  }
}

function statusLabel(status: SubmoduleCheckoutStatus): string {
  switch (status) {
    case 'uninitialized':
      return l10n.t('Not initialized');
    case 'conflict':
      return l10n.t('Conflict');
    case 'modified':
      return l10n.t('Modified');
    default:
      return l10n.t('Matches index');
  }
}

function worktreeNode(entry: GitWorktreeDto): SidebarNode {
  const label = worktreeBranchLabel(entry);
  const flags = [
    entry.current ? l10n.t('This window') : '',
    entry.locked ? l10n.t('Locked') : '',
    entry.prunable ? l10n.t('Prunable') : '',
    entry.detached ? l10n.t('Detached HEAD') : '',
  ].filter(Boolean);
  return {
    id: `worktree:${entry.path}`,
    kind: 'worktree',
    label,
    contextValue: entry.current ? SIDEBAR_CONTEXT.worktreeCurrent : SIDEBAR_CONTEXT.worktree,
    description: entry.path,
    tooltip: [label, entry.path, entry.head ? entry.head.slice(0, 7) : '', ...flags]
      .filter(Boolean)
      .join('\n'),
    ref: entry.path,
    children: [],
  };
}

function remoteBranchNode(branch: RefRemoteBranchDto): SidebarNode {
  return {
    id: `remoteBranch:${branch.name}`,
    kind: 'remoteBranch',
    label: leafName(branch.name),
    contextValue: SIDEBAR_CONTEXT.remoteBranch,
    tooltip: `${branch.name} · ${branch.shortSha}`,
    ref: branch.name,
    children: [],
  };
}

function stashNode(entry: StashEntryDto): SidebarNode {
  const shortSha = entry.sha.slice(0, 7);
  return {
    id: `stash:${entry.index}`,
    kind: 'stash',
    label: entry.selector,
    contextValue: SIDEBAR_CONTEXT.stash,
    description: entry.message || undefined,
    tooltip: `${entry.selector} · ${shortSha}${entry.message ? `\n${entry.message}` : ''}`,
    ref: entry.selector,
    children: [],
  };
}

function tagNode(tag: RefTagDto): SidebarNode {
  return {
    id: `tag:${tag.name}`,
    kind: 'tag',
    label: tag.name,
    contextValue: SIDEBAR_CONTEXT.tag,
    tooltip: `${tag.name} · ${tag.shortSha} (${tag.kind})`,
    ref: tag.name,
    children: [],
  };
}

function remoteNodes(snapshot: RefsSnapshotDto): SidebarNode[] {
  const urlByRemote = new Map(snapshot.remotes.map((r) => [r.name, r.urls[0] ?? '']));
  const branchesByRemote = new Map<string, RefRemoteBranchDto[]>();
  for (const branch of snapshot.remoteBranches) {
    // refs/remotes/<remote>/HEAD shortens to "<remote>" or "<remote>/HEAD".
    if (!branch.name.startsWith(`${branch.remote}/`) || branch.name.endsWith('/HEAD')) {
      continue;
    }
    const list = branchesByRemote.get(branch.remote) ?? [];
    list.push(branch);
    branchesByRemote.set(branch.remote, list);
  }

  const names = [...new Set([...urlByRemote.keys(), ...branchesByRemote.keys()])].sort(compareNames);
  return names.map((name) => {
    const url = urlByRemote.get(name) || undefined;
    const branches = branchesByRemote.get(name) ?? [];
    return {
      id: `remote:${name}`,
      kind: 'remote',
      label: name,
      contextValue: SIDEBAR_CONTEXT.remote,
      description: url,
      tooltip: url,
      ref: name,
      children: nestByPath(
        branches.map((branch) => ({
          path: branch.name.slice(name.length + 1),
          node: remoteBranchNode(branch),
        })),
        `remotes:${name}`,
      ),
    };
  });
}

function nestByPath(
  entries: readonly { path: string; node: SidebarNode }[],
  idScope: string,
): SidebarNode[] {
  const root: SidebarNode[] = [];
  const folders = new Map<string, SidebarNode>();

  for (const { path, node } of entries) {
    const segments = path.split('/');
    let siblings = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const folderPath = segments.slice(0, i + 1).join('/');
      let folder = folders.get(folderPath);
      if (!folder) {
        folder = {
          id: `folder:${idScope}:${folderPath}`,
          kind: 'folder',
          label: segments[i],
          contextValue: SIDEBAR_CONTEXT.folder,
          children: [],
        };
        folders.set(folderPath, folder);
        siblings.push(folder);
      }
      siblings = folder.children;
    }
    siblings.push(node);
  }

  sortFoldersFirst(root);
  return root;
}

function sortFoldersFirst(nodes: SidebarNode[]): void {
  nodes.sort((a, b) => {
    const aFolder = a.kind === 'folder' ? 0 : 1;
    const bFolder = b.kind === 'folder' ? 0 : 1;
    return aFolder - bFolder || compareNames(a.label, b.label);
  });
  for (const node of nodes) {
    if (node.kind === 'folder') {
      sortFoldersFirst(node.children);
    }
  }
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}

function leafName(name: string): string {
  return name.slice(name.lastIndexOf('/') + 1);
}

function nodeIcon(node: SidebarNode): string | undefined {
  switch (node.kind) {
    case 'localChanges':
      return 'diff';
    case 'allCommits':
      return 'history';
    case 'folder':
      return 'folder';
    case 'branch':
      if (node.isHead) {
        return 'check';
      }
      return node.checkedOutElsewhere ? 'folder-opened' : 'git-branch';
    case 'worktree':
      return 'worktree';
    case 'submodule':
      if (
        node.contextValue === SIDEBAR_CONTEXT.submoduleUninitialized ||
        node.contextValue === SIDEBAR_CONTEXT.submoduleConflict
      ) {
        return 'warning';
      }
      return 'file-submodule';
    case 'remote':
      return 'cloud';
    case 'remoteBranch':
      return 'git-branch';
    case 'tag':
      return 'tag';
    case 'stash':
      return 'git-stash';
    case 'pullRequest':
      return 'git-pull-request';
    case 'message':
      return 'warning';
    case 'section':
      return undefined;
  }
}

function nodeCollapsible(node: SidebarNode): SidebarCollapsible {
  if (node.expanded) {
    return 'expanded';
  }
  if (node.kind === 'section') {
    if (node.id === 'section:stashes') {
      return node.children.some((child) => child.kind === 'stash') ? 'expanded' : 'collapsed';
    }
    if (node.id === 'section:worktrees') {
      return node.children.some((child) => child.kind === 'worktree') ? 'expanded' : 'collapsed';
    }
    if (node.id === 'section:submodules') {
      return node.children.some((child) => child.kind === 'submodule') ? 'expanded' : 'collapsed';
    }
    return node.contextValue === SIDEBAR_CONTEXT.branchesSection ? 'expanded' : 'collapsed';
  }
  if (node.kind === 'folder' || node.kind === 'remote' || node.kind === 'submodule') {
    return node.children.length > 0 ? 'collapsed' : 'none';
  }
  return 'none';
}

function clickCommand(node: SidebarNode): string | undefined {
  switch (node.kind) {
    case 'localChanges':
      return SIDEBAR_COMMANDS.showLocalChanges;
    case 'allCommits':
      return SIDEBAR_COMMANDS.showAllCommits;
    case 'branch':
    case 'remoteBranch':
    case 'tag':
    case 'stash':
      return SIDEBAR_COMMANDS.revealInGraph;
    case 'worktree':
      return SIDEBAR_COMMANDS.openWorktree;
    case 'submodule':
      return SIDEBAR_COMMANDS.openSubmodule;
    default:
      return undefined;
  }
}
