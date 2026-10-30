import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import type { GraphCommitContext } from '../../shared/graph/graphProtocol';
import { GRAPH_CONTEXT_COMMANDS } from './graphContextCommands';

interface MenuEntry {
  command: string;
  when?: string;
}

const { contributes } = JSON.parse(
  readFileSync(join(__dirname, '../../../package.json'), 'utf8'),
) as {
  contributes: { commands: { command: string }[]; menus: Record<string, MenuEntry[]> };
};

const context: GraphCommitContext = {
  webviewSection: 'commit',
  graphSelection: 'multi',
  sha: 'aaa',
  subject: 'fix bug',
  shas: ['aaa', 'bbb'],
  preventDefaultContextMenuItems: true,
};

describe('GRAPH_CONTEXT_COMMANDS', () => {
  it('maps menu commands to the webview messages the panel already handles', () => {
    const message = (id: string) => GRAPH_CONTEXT_COMMANDS[id].toMessage(context);
    assert.deepEqual(message('gitCheckout.graph.checkout'), { type: 'historyCheckout', sha: 'aaa' });
    assert.deepEqual(message('gitCheckout.graph.interactiveRebase'), {
      type: 'historyInteractiveRebase',
      onto: 'aaa',
    });
    assert.deepEqual(message('gitCheckout.graph.copySubject'), { type: 'graphCopy', text: 'fix bug' });
    assert.deepEqual(message('gitCheckout.graph.squash'), {
      type: 'historyRange',
      op: 'squash',
      shas: ['aaa', 'bbb'],
    });
    assert.deepEqual(message('gitCheckout.graph.editMessage'), { type: 'historyEditMessage', sha: 'aaa' });
    assert.deepEqual(message('gitCheckout.graph.newBranch'), { type: 'historyNewBranch', sha: 'aaa' });
    // A branch or tag the commit has is a better start point than its hash.
    const newBranch = GRAPH_CONTEXT_COMMANDS['gitCheckout.graph.newBranch'];
    assert.deepEqual(newBranch.toMessage({ ...context, graphBranch: 'topic', graphBranchKind: 'local' }), { type: 'historyNewBranch', sha: 'aaa', startRef: 'topic' });
    assert.deepEqual(newBranch.toMessage({ ...context, graphStartRef: 'v1.2' }), { type: 'historyNewBranch', sha: 'aaa', startRef: 'v1.2' });
    assert.deepEqual(message('gitCheckout.graph.newTag'), { type: 'historyNewTag', sha: 'aaa' });
    assert.deepEqual(message('gitCheckout.graph.mergeHere'), { type: 'historyMerge', ref: 'aaa' });
    assert.deepEqual(message('gitCheckout.graph.rebaseHere'), { type: 'historyRebaseOnto', ref: 'aaa' });
    assert.deepEqual(
      GRAPH_CONTEXT_COMMANDS['gitCheckout.graph.deleteBranch'].toMessage({ ...context, graphBranch: 'origin/x', graphBranchKind: 'remote' }),
      { type: 'historyDeleteBranch', name: 'origin/x', remote: true },
    );
    assert.deepEqual(message('gitCheckout.graph.copyHashes'), { type: 'graphCopy', text: 'aaa\nbbb' });
  });

  it('declares each command, hides it from the palette and shows it for its selection only', () => {
    const declared = new Set(contributes.commands.map((c) => c.command));
    const hidden = new Set(
      contributes.menus.commandPalette.filter((m) => m.when === 'false').map((m) => m.command),
    );
    const menu = contributes.menus['webview/context'];
    const branchMenu = contributes.menus['gitCheckout.graph.branchMenu'] ?? [];
    for (const [id, command] of Object.entries(GRAPH_CONTEXT_COMMANDS)) {
      assert.ok(declared.has(id), `${id} not declared`);
      assert.ok(hidden.has(id), `${id} not hidden from the palette`);
      if (branchMenu.some((m) => m.command === id)) {
        continue;
      }
      const entries = menu.filter((m) => m.command === id);
      assert.equal(entries.length, 1, `${id} needs one webview/context entry`);
      assert.match(entries[0].when ?? '', /webviewId == 'gitCheckout\.main'/);
      assert.match(entries[0].when ?? '', new RegExp(`graphSelection == '${command.selection}'`));
    }
  });

  it('checks out the branch whose badge was right-clicked, whichever branches share the commit', () => {
    const on = (graphBranch: string, graphBranchKind: GraphCommitContext['graphBranchKind']) =>
      GRAPH_CONTEXT_COMMANDS['gitCheckout.graph.checkoutRef'].toMessage({ ...context, graphBranch, graphBranchKind });
    assert.deepEqual(on('feature', 'local'), { type: 'historyCheckoutRef', ref: 'feature', local: true });
    assert.deepEqual(on('origin/feature', 'remote'), { type: 'historyCheckoutRef', ref: 'origin/feature', local: false });
  });

  it('puts the branch actions in one Branch submenu, local-only ones for local branches', () => {
    const menu = contributes.menus['webview/context'];
    const submenu = menu.find((m) => (m as { submenu?: string }).submenu === 'gitCheckout.graph.branchMenu');
    assert.match(submenu?.when ?? '', /graphSelection == 'single' && graphBranch$/);
    const entries = contributes.menus['gitCheckout.graph.branchMenu'];
    const when = (id: string) => entries.find((m) => m.command === id)?.when;
    for (const id of ['fastForward', 'pull', 'push', 'rename']) {
      assert.equal(when(`gitCheckout.graph.branch.${id}`), 'graphBranchKind == local', id);
    }
    assert.equal(when('gitCheckout.graph.checkoutRef'), 'graphBranch');
    assert.equal(when('gitCheckout.graph.deleteBranch'), 'graphBranch');
    const commit = menu.find((m) => m.command === 'gitCheckout.graph.checkout')?.when ?? '';
    assert.doesNotMatch(commit, /graphBranch/);
  });
});
