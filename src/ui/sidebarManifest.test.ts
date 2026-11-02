import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { REVEAL_COMMAND_BASES, platformCommandIds } from '../shared/app/platformCommands';
import { PULL_REQUEST_COMMANDS } from './pullRequestNodes';
import {
  SIDEBAR_COMMANDS,
  SIDEBAR_CONTEXT,
  REPOSITORIES_VIEW_ID,
  PULL_REQUESTS_VIEW_ID,
  SIDEBAR_VIEW_ID,
} from './sidebarTreeModel';

interface MenuEntry {
  command?: string;
  when?: string;
  group?: string;
}

const manifest = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as {
  contributes: {
    commands: { command: string; enablement?: string }[];
    views: Record<string, { id: string; when?: string }[]>;
    viewsWelcome: { view: string }[];
    menus: Record<string, MenuEntry[]>;
  };
};
const { contributes } = manifest;
const sidebarCommands = [
  ...(Object.values(SIDEBAR_COMMANDS) as string[]).flatMap((id) =>
    (REVEAL_COMMAND_BASES as readonly string[]).includes(id) ? platformCommandIds(id) : [id],
  ),
  // The pull request rows have their own commands, since they act on GitHub and not on a ref.
  ...Object.values(PULL_REQUEST_COMMANDS),
];
/** Item menus apply to every section view. */
const SIDEBAR_VIEWS_WHEN = String.raw`view =~ /^gitCheckout\.sidebar(\.\w+)?$/`;
const itemMenus = contributes.menus['view/item/context'].filter((m) =>
  m.when?.includes(SIDEBAR_VIEWS_WHEN),
);

function matchesViewItem(when: string, contextValue: string): boolean {
  const exact = /viewItem == ([\w.]+)/.exec(when);
  if (exact) {
    return exact[1] === contextValue;
  }
  const pattern = /viewItem =~ \/(.+?)\/(?:\s|$)/.exec(when);
  return pattern ? new RegExp(pattern[1]).test(contextValue) : false;
}

function commandsFor(contextValue: string): string[] {
  return itemMenus
    .filter((m) => matchesViewItem(m.when ?? '', contextValue))
    .map((m) => m.command)
    .filter((c): c is string => typeof c === 'string');
}

describe('sidebar manifest contributions', () => {
  it('does not contribute the Show Only This in Graph action', () => {
    assert.equal(
      contributes.commands.some((command) => command.command === 'gitCheckout.sidebar.filterGraph'),
      false,
    );
    assert.equal(
      itemMenus.some((menu) => menu.command === 'gitCheckout.sidebar.filterGraph'),
      false,
    );
  });

  it('orders the sidebar: repositories, the commit form, the changes, the commit, files, then branches and the rest, then pull requests', () => {
    const ids = contributes.views['git-checkout'].map((view) => view.id);
    assert.deepEqual(ids, [
      REPOSITORIES_VIEW_ID,
      'gitCheckout.commitForm',
      'gitCheckout.changes',
      'gitCheckout.commitFiles',
      'gitCheckout.tree',
      SIDEBAR_VIEW_ID,
      PULL_REQUESTS_VIEW_ID,
    ]);
  });

  it('always shows the Repositories view, even with one repository', () => {
    const view = contributes.views['git-checkout'].find((entry) => entry.id === REPOSITORIES_VIEW_ID);
    assert.equal(view?.when, undefined);
  });

  it('puts search on a button of the Repository view, outside the three dots, where it filters', () => {
    const titleMenu = contributes.menus['view/title'] as MenuEntry[];
    const buttons = (view: string) => titleMenu.filter((entry) => new RegExp(`^view == ${view.replaceAll('.', '\\.')}( |$)`).test(entry.when ?? '') && entry.group?.startsWith('navigation')).map((entry) => entry.command);
    assert.deepEqual(buttons('gitCheckout.sidebar'), [SIDEBAR_COMMANDS.search, SIDEBAR_COMMANDS.clearSearch]);
    assert.deepEqual(buttons(REPOSITORIES_VIEW_ID), []);
  });

  it('uses the Repositories view for the welcome content', () => {
    assert.ok(contributes.viewsWelcome.some((w) => w.view === REPOSITORIES_VIEW_ID));
  });

  it('always shows the Repositories view, even with one repository', () => {
    const view = contributes.views['git-checkout'].find((entry) => entry.id === REPOSITORIES_VIEW_ID);
    assert.equal(view?.when, undefined);
  });

  it('puts search in the menu of the Repository view, where it filters', () => {
    const titleMenu = contributes.menus['view/title'] as MenuEntry[];
    const on = (view: string) => titleMenu.filter((entry) => entry.when?.startsWith(`view == ${view}`)).map((entry) => entry.command);
    assert.ok(on('gitCheckout.sidebar').includes(SIDEBAR_COMMANDS.search));
    assert.ok(on('gitCheckout.sidebar').includes(SIDEBAR_COMMANDS.clearSearch));
    assert.ok(!on(REPOSITORIES_VIEW_ID).includes(SIDEBAR_COMMANDS.search));
  });

  it('uses the Repositories view for the welcome content', () => {
    assert.ok(contributes.viewsWelcome.some((w) => w.view === REPOSITORIES_VIEW_ID));
  });

  it('does not contribute a repository row menu', () => {
    assert.equal(
      itemMenus.some((m) => m.when?.includes('viewItem == repository')),
      false,
    );
  });

  it('declares every sidebar command and hides it from the command palette unless the tab toolbar has it', () => {
    const declared = new Set(contributes.commands.map((c) => c.command));
    const hidden = new Set(
      contributes.menus.commandPalette.filter((m) => m.when === 'false').map((m) => m.command),
    );
    const onToolbar = new Set(contributes.menus['editor/title'].map((m) => m.command));
    for (const id of sidebarCommands) {
      assert.ok(declared.has(id), `${id} not declared`);
      assert.ok(onToolbar.has(id) || hidden.has(id), `${id} not hidden from the palette`);
    }
  });

  it('only references known sidebar commands in item menus', () => {
    for (const entry of itemMenus) {
      if (entry.command) {
        assert.ok(sidebarCommands.includes(entry.command), `unknown command ${entry.command}`);
      }
    }
  });

  it('gives every actionable node kind a context menu', () => {
    const withoutMenus = new Set<string>([
      // A repository's row opens its graph; its right-click menu has the actions.
      SIDEBAR_CONTEXT.repository,
      // The Pull Requests view has its Refresh in its title bar.
      SIDEBAR_CONTEXT.pullRequestsSection,
      SIDEBAR_CONTEXT.folder,
      SIDEBAR_CONTEXT.message,
      // A button that signs in or tries again; clicking it is all it does.
      SIDEBAR_CONTEXT.pullRequestAction,
    ]);
    for (const contextValue of Object.values(SIDEBAR_CONTEXT)) {
      if (!withoutMenus.has(contextValue)) {
        assert.ok(commandsFor(contextValue).length > 0, `no menu for ${contextValue}`);
      }
    }
  });

  it('hides destructive and self-referencing actions on the current branch', () => {
    const head = commandsFor(SIDEBAR_CONTEXT.headBranch);
    const trackedHead = commandsFor(SIDEBAR_CONTEXT.trackedHeadBranch);
    for (const id of [
      SIDEBAR_COMMANDS.checkoutTag,
      SIDEBAR_COMMANDS.merge,
      SIDEBAR_COMMANDS.rebase,
      SIDEBAR_COMMANDS.deleteBranch,
    ]) {
      assert.equal(head.includes(id), false, `${id} shown on HEAD`);
      assert.equal(trackedHead.includes(id), false, `${id} shown on tracked HEAD`);
    }
    assert.ok(commandsFor(SIDEBAR_CONTEXT.localBranch).includes(SIDEBAR_COMMANDS.deleteBranch));
    assert.ok(commandsFor(SIDEBAR_CONTEXT.trackedLocalBranch).includes(SIDEBAR_COMMANDS.deleteBranch));
    assert.ok(commandsFor(SIDEBAR_CONTEXT.trackedLocalBranch).includes(SIDEBAR_COMMANDS.checkout));
    assert.ok(trackedHead.includes(SIDEBAR_COMMANDS.pullBranch));
  });

  it('offers open, reveal, copy path, and delete on worktrees except the current one', () => {
    const shared = [SIDEBAR_COMMANDS.openWorktree, SIDEBAR_COMMANDS.revealWorktree, SIDEBAR_COMMANDS.copyWorktreePath];
    for (const id of shared) {
      assert.ok(commandsFor(SIDEBAR_CONTEXT.worktree).includes(id), `${id} missing on worktrees`);
      assert.ok(commandsFor(SIDEBAR_CONTEXT.worktreeCurrent).includes(id), `${id} missing on current worktree`);
    }
    assert.ok(commandsFor(SIDEBAR_CONTEXT.worktree).includes(SIDEBAR_COMMANDS.deleteWorktree));
    assert.equal(commandsFor(SIDEBAR_CONTEXT.worktreeCurrent).includes(SIDEBAR_COMMANDS.deleteWorktree), false);
    assert.ok(commandsFor(SIDEBAR_CONTEXT.worktreesSection).includes(SIDEBAR_COMMANDS.createWorktree));
  });

  it('offers open, terminal, reveal, update, add, delete, and copy on submodules', () => {
    for (const ctx of [
      SIDEBAR_CONTEXT.submodule,
      SIDEBAR_CONTEXT.submoduleModified,
      SIDEBAR_CONTEXT.submoduleUninitialized,
      SIDEBAR_CONTEXT.submoduleConflict,
    ]) {
      const cmds = commandsFor(ctx);
      for (const id of [
        SIDEBAR_COMMANDS.openSubmodule,
        SIDEBAR_COMMANDS.openSubmoduleInTerminal,
        SIDEBAR_COMMANDS.revealSubmodule,
        SIDEBAR_COMMANDS.updateSubmodule,
        SIDEBAR_COMMANDS.addSubmodule,
        SIDEBAR_COMMANDS.deleteSubmodule,
        SIDEBAR_COMMANDS.copySubmodulePath,
      ]) {
        assert.ok(cmds.includes(id), `${id} missing on ${ctx}`);
      }
    }
    const section = commandsFor(SIDEBAR_CONTEXT.submodulesSection);
    assert.ok(section.includes(SIDEBAR_COMMANDS.addSubmodule));
    assert.ok(section.includes(SIDEBAR_COMMANDS.updateSubmodules));
    assert.equal(section.includes(SIDEBAR_COMMANDS.deleteSubmodule), false);
  });

  it('offers worktree checkout, copy branch name, create branch, and create tag on branches', () => {
    for (const ctx of [
      SIDEBAR_CONTEXT.localBranch,
      SIDEBAR_CONTEXT.headBranch,
      SIDEBAR_CONTEXT.remoteBranch,
    ]) {
      const cmds = commandsFor(ctx);
      assert.ok(
        cmds.includes(SIDEBAR_COMMANDS.checkoutAsWorktree),
        `checkoutAsWorktree missing on ${ctx}`,
      );
      assert.ok(cmds.includes(SIDEBAR_COMMANDS.copyBranchName), `copyBranchName missing on ${ctx}`);
      assert.ok(cmds.includes(SIDEBAR_COMMANDS.createBranch), `createBranch missing on ${ctx}`);
      assert.ok(cmds.includes(SIDEBAR_COMMANDS.createTag), `createTag missing on ${ctx}`);
    }
  });

  it('offers modal pull on HEAD and modal push on local branches', () => {
    const head = commandsFor(SIDEBAR_CONTEXT.headBranch);
    const local = commandsFor(SIDEBAR_CONTEXT.localBranch);
    const remote = commandsFor(SIDEBAR_CONTEXT.remoteBranch);
    assert.ok(head.includes(SIDEBAR_COMMANDS.fastForward));
    assert.ok(head.includes(SIDEBAR_COMMANDS.pullBranch));
    assert.ok(head.includes(SIDEBAR_COMMANDS.pushBranch));
    assert.ok(local.includes(SIDEBAR_COMMANDS.fastForward));
    assert.equal(local.includes(SIDEBAR_COMMANDS.pullBranch), false);
    assert.ok(local.includes(SIDEBAR_COMMANDS.pushBranch));
    assert.ok(remote.includes(SIDEBAR_COMMANDS.pullBranch));
    assert.ok(remote.includes(SIDEBAR_COMMANDS.merge));
    assert.ok(remote.includes(SIDEBAR_COMMANDS.rebase));
    assert.ok(remote.includes(SIDEBAR_COMMANDS.deleteBranch));
  });

  it('offers modal fetch for remote repositories', () => {
    assert.ok(commandsFor(SIDEBAR_CONTEXT.remote).includes(SIDEBAR_COMMANDS.fetchRemote));
  });

  it('offers a single New Tag action in the Tags section menu', () => {
    const tags = commandsFor(SIDEBAR_CONTEXT.tagsSection);
    assert.deepEqual(tags, [SIDEBAR_COMMANDS.createTag]);
  });

  it('offers the tag actions shown in the tag context menu', () => {
    const tag = commandsFor(SIDEBAR_CONTEXT.tag);
    for (const command of [
      SIDEBAR_COMMANDS.checkoutTag,
      SIDEBAR_COMMANDS.showTagDetails,
      SIDEBAR_COMMANDS.pushTag,
      SIDEBAR_COMMANDS.merge,
      SIDEBAR_COMMANDS.rebase,
      SIDEBAR_COMMANDS.interactiveRebaseTag,
      SIDEBAR_COMMANDS.createBranch,
      SIDEBAR_COMMANDS.createTag,
      SIDEBAR_COMMANDS.deleteTag,
      SIDEBAR_COMMANDS.copyTagName,
    ]) {
      assert.ok(tag.includes(command), `${command} missing from tag context menu`);
    }
  });

  it('offers direct tracking actions in the branch management group', () => {
    for (const command of [SIDEBAR_COMMANDS.unsetUpstream, SIDEBAR_COMMANDS.setUpstream]) {
      const entry = itemMenus.find((menu) => menu.command === command);
      assert.ok(entry, `${command} missing from branch context menu`);
      assert.match(entry.when ?? '', /viewItem =~ \/\^branch\\\.local\//);
      assert.match(entry.group ?? '', /^5_branch@/);
    }
    assert.equal(
      contributes.commands.find((command) => command.command === SIDEBAR_COMMANDS.unsetUpstream)
        ?.enablement,
      `viewItem == ${SIDEBAR_CONTEXT.trackedLocalBranch} || viewItem == ${SIDEBAR_CONTEXT.trackedHeadBranch}`,
    );
  });

  it('has no inline quick-action buttons on sidebar rows, only context-menu entries', () => {
    const rows = contributes.menus['view/item/context'].filter((entry) =>
      /gitCheckout\\\.sidebar/.test(entry.when ?? ''));
    assert.ok(rows.length > 0);
    assert.deepEqual(rows.filter((entry) => entry.group?.startsWith('inline')), []);
    // Every action that used to have a button is still in the context menu.
    for (const command of ['applyStash', 'popStash', 'copyWorktreePath', 'updateSubmodule', 'copySubmodulePath']) {
      assert.ok(rows.some((entry) => entry.command === `gitCheckout.sidebar.${command}`), command);
    }
  });
});

