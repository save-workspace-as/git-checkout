import { REPOSITORIES_VIEW_ID, SIDEBAR_VIEW_ID } from './sidebarTreeModel';

/** One entry of the Repository dropdown in the Repositories view's title bar. */
export interface RepositoryAction {
  id: string;
  /** Existing command that does the work. It acts on the selected repository. */
  command: string;
  /** Menu group; entries sort within it by order and groups are separated by a line. */
  group: string;
  enablement?: string;
  /** Shown only when this holds, like the platform's wording of "reveal in the file manager". */
  when?: string;
}

const IDLE = '!gitCheckout.repoOperationActive';
const SYNC_IDLE = '!gitCheckout.syncBusy && !gitCheckout.repoOperationActive';

export const REPOSITORY_ACTIONS: readonly RepositoryAction[] = [
  { id: 'fetch', command: 'gitCheckout.fetch', group: '2_sync', enablement: SYNC_IDLE },
  { id: 'pull', command: 'gitCheckout.pull', group: '2_sync', enablement: SYNC_IDLE },
  { id: 'push', command: 'gitCheckout.push', group: '2_sync', enablement: SYNC_IDLE },
  { id: 'saveStash', command: 'gitCheckout.sidebar.createStash', group: '3_stash', enablement: IDLE },
  { id: 'undo', command: 'gitCheckout.undo', group: '4_undo', enablement: IDLE },
  { id: 'newBranch', command: 'gitCheckout.sidebar.createBranch', group: '5_create', enablement: IDLE },
  { id: 'newTag', command: 'gitCheckout.sidebar.createTag', group: '5_create', enablement: IDLE },
  { id: 'newWorktree', command: 'gitCheckout.sidebar.createWorktree', group: '5_create', enablement: IDLE },
  { id: 'gitFlow', command: 'gitCheckout.gitFlow', group: '6_tools', enablement: IDLE },
  { id: 'createPatch', command: 'gitCheckout.createPatch', group: '7_patch', enablement: IDLE },
  { id: 'applyPatch', command: 'gitCheckout.applyPatch', group: '7_patch', enablement: IDLE },
  { id: 'settings', command: 'gitCheckout.repoSettings', group: '8_settings' },
  // One entry per system, each named the way that system names it.
  { id: 'reveal', command: 'revealFileInOS', group: '9_open', when: 'isMac' },
  { id: 'revealWindows', command: 'revealFileInOS', group: '9_open', when: 'isWindows' },
  { id: 'revealLinux', command: 'revealFileInOS', group: '9_open', when: 'isLinux' },
  { id: 'terminal', command: 'gitCheckout.openRepoTerminal', group: '9_open' },
];

/** Command that runs `actionId` on the selected repository. */
export function repositoryActionCommand(actionId: string): string {
  return `gitCheckout.repo.${actionId}`;
}

/** The prefix of the submenus that each repository view used to have; none is left. */
export const REPOSITORY_MENU_ID = 'gitCheckout.repoMenu';

interface Manifest {
  contributes: {
    commands: { command: string; enablement?: string; title: string }[];
    submenus?: { id: string; label: string; icon: string }[];
    menus: Record<string, Record<string, unknown>[]>;
  };
}

const isRepositoryCommand = (command: unknown): boolean =>
  typeof command === 'string' && command.startsWith('gitCheckout.repo.');
const isRepositoryMenu = (id: unknown): boolean => typeof id === 'string' && id.startsWith(REPOSITORY_MENU_ID);

/**
 * The actions on a repository, as the right-click menu of its row in the Repositories view and as the "…" menu of the
 * Repository view, with a hidden command for each. Rewrites those entries; idempotent.
 */
export function applyRepositoryMenu<T extends Manifest>(manifest: T): T {
  const { contributes } = manifest;
  const menus = contributes.menus;
  contributes.commands = contributes.commands.filter((entry) => !isRepositoryCommand(entry.command));
  contributes.submenus = (contributes.submenus ?? []).filter((entry) => !isRepositoryMenu(entry.id));
  for (const key of Object.keys(menus)) {
    if (isRepositoryMenu(key)) {
      delete menus[key];
    }
  }
  for (const key of ['commandPalette', 'view/title', 'view/item/context']) {
    menus[key] = (menus[key] ?? []).filter(
      (entry) => !isRepositoryCommand(entry.command) && !isRepositoryMenu(entry.submenu),
    );
  }

  const when = (view: string, action: RepositoryAction, row = ''): string =>
    [`view == ${view}`, row, action.when].filter(Boolean).join(' && ');
  REPOSITORY_ACTIONS.forEach((action, order) => {
    const command = repositoryActionCommand(action.id);
    const group = `${action.group}@${order}`;
    contributes.commands.push({
      command,
      ...(action.enablement ? { enablement: action.enablement } : {}),
      title: `%command.gitCheckout.repo.${action.id}.title%`,
    });
    menus.commandPalette.push({ command, when: 'false' });
    // Right-click on a repository, and the "…" of the Repository view, which acts on the selected repository.
    menus['view/item/context'].push({ command, group, when: when(REPOSITORIES_VIEW_ID, action, 'viewItem == repository') });
    menus['view/title'].push({ command, group, when: when(SIDEBAR_VIEW_ID, action) });
  });
  return manifest;
}
