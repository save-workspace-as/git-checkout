import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import type { GitCheckoutSettingsReader } from '../../core/gitCheckoutSettings';
import { defaultGitCheckoutSettings } from '../../core/gitCheckoutSettings';
import { HistoryService } from './historyService';
import { mockCliRegistry, mockGitCli } from '../../core/testing/serviceTestUtils';

const REPO = '/repo';

function settings(overrides: Partial<GitCheckoutSettingsReader>): GitCheckoutSettingsReader {
  return { ...defaultGitCheckoutSettings, ...overrides };
}

describe('HistoryService.reset', () => {
  it('maps reset modes to git flags', async () => {
    const { cli, writes } = mockGitCli();
    const svc = new HistoryService(mockCliRegistry(REPO, cli));

    await svc.reset(REPO, 'hard', 'HEAD~2');
    assert.deepEqual(writes[0], ['reset', '--hard', 'HEAD~2']);
  });
});

describe('HistoryService.cherryPick', () => {
  it('appends --no-verify when skip hooks is enabled', async () => {
    const { cli, writes } = mockGitCli();
    const svc = new HistoryService(
      mockCliRegistry(REPO, cli),
      settings({ gitSkipHooks: () => true }),
    );

    await svc.cherryPick(REPO, 'abc123', 2);
    assert.deepEqual(writes[0], ['cherry-pick', '-m', '2', 'abc123', '--no-verify']);
  });
});

describe('HistoryService.orderOldestFirst', () => {
  it('sorts shas by committer time ascending', async () => {
    const { cli } = mockGitCli({
      execRead: async (args) => {
        const sha = args[args.length - 1];
        const times: Record<string, string> = {
          new: '200\n',
          mid: '150\n',
          old: '100\n',
        };
        return { stdout: times[sha] ?? '0\n' };
      },
    });
    const svc = new HistoryService(mockCliRegistry(REPO, cli));

    const ordered = await svc.orderOldestFirst(REPO, ['new', 'old', 'mid', 'new']);
    assert.deepEqual(ordered, ['old', 'mid', 'new']);
  });

  it('orders a chain correctly even when the answers arrive out of order', async () => {
    const delays: Record<string, number> = { c: 1, b: 15, a: 30 };
    const { cli } = mockGitCli({
      execRead: async (args) => {
        const sha = args[args.length - 1];
        await new Promise((resolve) => setTimeout(resolve, delays[sha] ?? 0));
        // Same commit time for all of them, as when commits are made in one second: ancestry decides.
        const count = args[0] === 'rev-list' ? { a: '1\n', b: '2\n', c: '3\n' }[sha] : '100\n';
        return { stdout: count ?? '0\n' };
      },
    });
    const svc = new HistoryService(mockCliRegistry(REPO, cli));
    assert.deepEqual(await svc.orderOldestFirst(REPO, ['c', 'a', 'b']), ['a', 'b', 'c']);
  });
});

describe('HistoryService.getParents', () => {
  it('returns parent shas from rev-list --parents', async () => {
    const { cli } = mockGitCli({
      execRead: async () => ({ stdout: 'child parent1 parent2\n' }),
    });
    const svc = new HistoryService(mockCliRegistry(REPO, cli));

    const parents = await svc.getParents(REPO, 'child');
    assert.deepEqual(parents, ['parent1', 'parent2']);
  });
});

describe('HistoryService.cherryPickRange', () => {
  it('cherry-picks oldest..newest after ordering', async () => {
    const { cli, writes } = mockGitCli({
      execRead: async (args) => {
        const sha = args[args.length - 1];
        const times: Record<string, string> = {
          a: '10\n',
          b: '20\n',
        };
        return { stdout: times[sha] ?? '0\n' };
      },
    });
    const svc = new HistoryService(mockCliRegistry(REPO, cli));

    await svc.cherryPickRange(REPO, ['b', 'a']);
    assert.deepEqual(writes[0], ['cherry-pick', 'a^..b']);
  });
});
