import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import * as vscode from 'vscode';

import { createFixtureRepo, isSentinelFolder } from './fixtureRepo';

// Mirrors src/ui/sidebarTreeModel.ts and src/extension.ts; e2e compiles separately.
export interface SidebarNode {
  id: string;
  kind: string;
  label: string;
  description?: string;
  ref?: string;
  repoRoot?: string;
  isHead?: boolean;
  children: SidebarNode[];
}

/** A row of the Unstaged or Staged list. */
export interface ChangeRow {
  kind: 'file' | 'dir';
  key: string;
  path: string;
  label: string;
  side: 'staged' | 'unstaged';
  children?: ChangeRow[];
}

/** A row of a commit's changed files or of the File Tree. */
export interface RevisionRow {
  kind: 'file' | 'dir';
  key: string;
  path: string;
  label: string;
  revision?: string;
  baseRevision?: string;
  status?: string;
  commitTreeKind: 'blob' | 'tree';
  children?: RevisionRow[];
}

export interface GitCheckoutApi {
  sidebar: vscode.TreeDataProvider<SidebarNode>;
  sidebars: vscode.TreeDataProvider<SidebarNode>[];
  activityBadge(): number | undefined;
  sendPanelMessage(message: { type: string } & Record<string, unknown>): Promise<void>;
  changesLists: Record<'unstaged' | 'staged', vscode.TreeDataProvider<ChangeRow>>;
  revisionLists: Record<'commitFiles' | 'tree', vscode.TreeDataProvider<RevisionRow>>;
  /** The files the Changes tab lists. */
  commitFiles(): { sha: string; baseSha?: string; files: { path: string; status: string }[] } | undefined;
  selectRepository(repoRoot: string): Promise<void>;
  /** What the banner above the graph says about the selected repository; `undefined` when it is hidden. */
  operationBanner(): Promise<{
    title: string;
    message: string;
    progress?: number;
    canAbort: boolean;
    primary: 'resolve' | 'continue' | null;
  } | undefined>;
  /** Whether the window has a repository to show and, if not, why. */
  panelState(): Promise<{ empty: boolean; emptyReason?: string; repositories: string[] }>;
  /** The commits and ref labels the graph shows for all commits. */
  graphCommits(): Promise<{ subject: string; refs: string[] }[]>;
  autoFetchNow(): Promise<void>;
  operationFormState(): {
    sessionId: number;
    form: {
      title: string;
      description?: string;
      notice?: { kind: string; message: string };
      values: Record<string, string | boolean>;
      fields: {
        id: string;
        type: string;
        description?: string;
        readOnly?: boolean;
        multiline?: boolean;
        pickLabel?: string;
        replaceWhitespace?: string;
        suggestions?: { value: string }[];
      }[];
    };
  } | undefined;
}

export const EXTENSION_ID = 'rkonit.git-checkout';
/** Webview panel viewType from createWebviewPanel, not a command id. */
export const PANEL_VIEW_TYPE = 'gitCheckout.main';
const PANEL_TITLE = 'Git Checkout';

interface GitApi {
  repositories: readonly { rootUri: vscode.Uri }[];
}

interface GitExtensionApi {
  getAPI(version: 1): GitApi;
}

function samePath(left: string, right: string): boolean {
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return left === right;
  }
}

export function repoRoot(): string {
  const fixture = vscode.workspace.workspaceFolders?.find(
    (folder) => !isSentinelFolder(folder.uri.fsPath),
  );
  assert.ok(fixture, 'e2e fixture folder is not open');
  return fixture.uri.fsPath;
}

function errorText(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return '';
  }
  const message = 'message' in error && typeof error.message === 'string' ? error.message : '';
  const stderr = 'stderr' in error && typeof error.stderr === 'string' ? error.stderr : '';
  return `${message}\n${stderr}`;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function git(...args: string[]): string {
  // vscode.git locks the index while it discovers a fresh fixture. Wait that out.
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      return execFileSync('git', args, { cwd: repoRoot(), encoding: 'utf8' }).trim();
    } catch (error) {
      if (Date.now() >= deadline || !errorText(error).includes('index.lock')) {
        throw error;
      }
      sleepSync(100);
    }
  }
}

async function gitRepositoryRoots(): Promise<readonly string[]> {
  const extension = vscode.extensions.getExtension<GitExtensionApi>('vscode.git');
  assert.ok(extension, 'vscode.git is not loaded');
  const api = extension.isActive ? extension.exports : await extension.activate();
  return api.getAPI(1).repositories.map((repository) => repository.rootUri.fsPath);
}

/** Opens a new fixture repository for this test. */
export async function openFreshFixture(): Promise<void> {
  const next = createFixtureRepo();
  const folders = vscode.workspace.workspaceFolders ?? [];
  const index = folders.findIndex((folder) => !isSentinelFolder(folder.uri.fsPath));
  assert.ok(index >= 0, 'e2e fixture folder is missing');
  assert.ok(
    vscode.workspace.updateWorkspaceFolders(index, 1, { uri: vscode.Uri.file(next) }),
    'could not open a fresh e2e repository',
  );
  await waitFor('fresh repository', async () => {
    const fixture = vscode.workspace.workspaceFolders?.find(
      (folder) => !isSentinelFolder(folder.uri.fsPath),
    );
    if (!fixture || !samePath(fixture.uri.fsPath, next)) {
      return undefined;
    }
    const roots = await gitRepositoryRoots();
    // Git keeps the repository of a file that was open in an editor (a merge editor, say) after the folder
    // is gone; close those, or they would show up in every list of repositories.
    for (const stale of roots.filter((root) => !samePath(root, next))) {
      await vscode.commands.executeCommand('git.close', vscode.Uri.file(stale));
    }
    return roots.length === 1 && samePath(roots[0], next) ? true : undefined;
  });
}

/** Activates the extension once and opens a new fixture repo before every test in this suite. */
export function bindExtension(): {
  extension: vscode.Extension<GitCheckoutApi>;
  api: GitCheckoutApi;
} {
  const ctx = {} as { extension: vscode.Extension<GitCheckoutApi>; api: GitCheckoutApi };
  before(async () => {
    const activated = await activateExtension();
    ctx.extension = activated.extension;
    ctx.api = activated.api;
  });
  beforeEach(openFreshFixture);
  return ctx;
}

export async function assertCommands(
  extension: vscode.Extension<GitCheckoutApi>,
  expected?: readonly string[],
): Promise<void> {
  const registered = new Set(await vscode.commands.getCommands(true));
  const declared = (extension.packageJSON.contributes.commands as { command: string }[]).map(
    (command) => command.command,
  );
  const wanted = expected ?? declared;
  const missing = wanted.filter(
    (id) => !registered.has(id) || (expected !== undefined && !declared.includes(id)),
  );
  assert.ok(wanted.length > 0);
  assert.deepEqual(missing, []);
}

export async function readyRef(api: GitCheckoutApi, ref: string): Promise<SidebarNode> {
  const node = findByRef(await readyTree(api), ref);
  assert.ok(node, `sidebar is missing ${ref}`);
  return node;
}

export async function waitFor<T>(
  what: string,
  probe: () => Promise<T | undefined>,
  timeoutMs = 30_000,
  describeFailure?: () => string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() > deadline) {
      const detail = describeFailure?.();
      throw new Error(detail ? `Timed out waiting for ${what}\n${detail}` : `Timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

export function findByRef(nodes: SidebarNode[], ref: string): SidebarNode | undefined {
  for (const node of nodes) {
    if (node.ref === ref && node.kind !== 'remote') {
      return node;
    }
    const nested = findByRef(node.children, ref);
    if (nested) {
      return nested;
    }
  }
  return undefined;
}

export function branchesOf(tree: SidebarNode[]): SidebarNode[] {
  return tree.find((node) => node.id === 'section:branches')?.children ?? [];
}

export async function activateExtension(): Promise<{
  extension: vscode.Extension<GitCheckoutApi>;
  api: GitCheckoutApi;
}> {
  const extension = vscode.extensions.getExtension<GitCheckoutApi>(EXTENSION_ID);
  assert.ok(extension, `${EXTENSION_ID} is not loaded`);
  return { extension, api: await extension.activate() };
}

/** Rows of the first repository's view. */
export async function loadTree(api: GitCheckoutApi): Promise<SidebarNode[]> {
  return (await api.sidebar.getChildren()) ?? [];
}

export async function readyTree(api: GitCheckoutApi): Promise<SidebarNode[]> {
  return waitFor('sidebar with main checked out', async () => {
    const nodes = await loadTree(api);
    const main = findByRef(nodes, 'main');
    return branchesOf(nodes).length > 0 && main?.isHead ? nodes : undefined;
  });
}

function viewTypeOf(input: unknown): string | undefined {
  if (!input || typeof input !== 'object' || !('viewType' in input)) {
    return undefined;
  }
  const viewType = input.viewType;
  return typeof viewType === 'string' ? viewType : undefined;
}

export function gitCheckoutPanelOpen(): boolean {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.label === PANEL_TITLE) {
        return true;
      }
      const viewType = viewTypeOf(tab.input);
      if (viewType?.includes(PANEL_VIEW_TYPE)) {
        return true;
      }
    }
  }
  return false;
}

export function openTabSummary(): string {
  const tabs = vscode.window.tabGroups.all.flatMap((group) =>
    group.tabs.map((tab) => `${tab.label} (${viewTypeOf(tab.input) ?? 'no-view'})`),
  );
  return tabs.length > 0 ? tabs.join(', ') : 'none';
}

export async function waitForGitCheckoutPanel(): Promise<void> {
  await waitFor(
    'Git Checkout panel tab',
    async () => (gitCheckoutPanelOpen() ? true : undefined),
    30_000,
    () => `open tabs: ${openTabSummary()}`,
  );
}
