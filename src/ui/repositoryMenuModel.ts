import { SIDEBAR_REPO_SLOTS, sidebarViewId } from './sidebarTreeModel';

/** One entry of the Repository dropdown in a repository view's title bar. */
export interface RepositoryAction {
  id: string;
  /** Existing command that does the work. It acts on the repository the view shows. */
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

/** Command that runs `actionId` on the repository shown in view slot `slot`. */
export function repositoryActionCommand(slot: number, actionId: string): string {
  return `gitCheckout.repo.${slot}.${actionId}`;
}

export function repositoryMenuId(slot: number): string {
  return `gitCheckout.repoMenu.${slot}`;
}

interface Manifest {
  contributes: {
    commands: { command: string; enablement?: string; title: string }[];
    submenus?: { id: string; label: string; icon: string }[];
    menus: Record<string, Record<string, unknown>[]>;
  };
}

const isRepositoryCommand = (command: unknown): boolean =>
  typeof command === 'string' && command.startsWith('gitCheckout.repo.');
const isRepositoryMenu = (id: unknown): boolean =>
  typeof id === 'string' && id.startsWith('gitCheckout.repoMenu.');

/**
 * VS Code gives a view's title action no way to tell which view it was clicked in, so every
 * repository view gets its own commands and dropdown. Rewrites those entries; idempotent.
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
  for (const key of ['commandPalette', 'view/title']) {
    menus[key] = (menus[key] ?? []).filter(
      (entry) => !isRepositoryCommand(entry.command) && !isRepositoryMenu(entry.submenu),
    );
  }

  for (let slot = 0; slot < SIDEBAR_REPO_SLOTS; slot += 1) {
    const menu = repositoryMenuId(slot);
    contributes.submenus.push({
      id: menu,
      label: '%submenu.gitCheckout.repository.label%',
      icon: '$(ellipsis)',
    });
    menus['view/title'].push({
      submenu: menu,
      group: 'navigation@9',
      when: `view == ${sidebarViewId(slot)}`,
    });
    menus[menu] = REPOSITORY_ACTIONS.map((action, order) => ({
      command: repositoryActionCommand(slot, action.id),
      group: `${action.group}@${order}`,
      ...(action.when ? { when: action.when } : {}),
    }));
    for (const action of REPOSITORY_ACTIONS) {
      const command = repositoryActionCommand(slot, action.id);
      contributes.commands.push({
        command,
        ...(action.enablement ? { enablement: action.enablement } : {}),
        title: `%command.gitCheckout.repo.${action.id}.title%`,
      });
      menus.commandPalette.push({ command, when: 'false' });
    }
  }
  return manifest;
}
