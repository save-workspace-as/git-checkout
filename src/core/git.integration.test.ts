import { strict as assert } from 'node:assert';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { layoutGraph } from '../shared/graph/graphLanes';
import { ALL_COMMITS_FILTER, type GraphOrder } from '../shared/graph/graphProtocol';
import { buildSidebarTree } from '../ui/sidebarTreeModel';
import { buildGraphLogArgs, CommitGraphService } from '../features/graph/commitGraphService';
import { parseGitLog } from './gitLogParser';
import {
    commitEmptyAt,
    GIT_TEST_IDENTITY_ENV,
    initTempRepository,
    runGit,
    runGitAllowFailure,
    seedDivergentFileConflict,
} from './testing/gitRepoHarness';
import { resolveRepositoryLayout } from './gitRepositoryLayout';
import { HistoryService } from '../features/history/historyService';
import { checkMergePreflight } from '../features/branches/mergePreflight';
import { RefsService } from '../features/branches/refsService';
import { RepoOperationService } from '../features/operations/repoOperationService';
import {
    mockCliRegistry,
    mockExtensionContext,
    mockGitExtensionService,
    mockRepository,
} from './testing/serviceTestUtils';

function mockGraphService(headRef: string | null, filterRef?: string): CommitGraphService {
  return {
    resolveHeadRef: () => headRef,
    currentBranch: async () => headRef,
    getFilterRef: () => filterRef ?? headRef ?? 'HEAD',
  } as unknown as CommitGraphService;
}

describe('GitCli integration', () => {
  it('runs rev-parse against a real temporary repository', async () => {
    const repo = initTempRepository();
    try {
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'init']);

      assert.equal(await repo.cli.isInsideWorkTree(), true);

      const dirs = await repo.cli.resolveGitDirectories();
      assert.ok(dirs.gitDir.includes('.git'));
      assert.ok(dirs.commonDir.length > 0);

      const head = await repo.cli.revParseShortHead();
      assert.ok(head && head.length >= 7);
    } finally {
      repo.cleanup();
    }
  });
});

describe('git integration', () => {
  it('checkMergePreflight detects a real content conflict', async () => {
    const repo = initTempRepository();
    try {
      seedDivergentFileConflict(repo);

      const result = await checkMergePreflight(repo.cli, 'other');
      assert.equal(result.wouldConflict, true);
      assert.ok(result.conflictFiles.includes('conflict.txt'));
    } finally {
      repo.cleanup();
    }
  });

  it('checkMergePreflight reports no conflict for a fast-forward merge', async () => {
    const repo = initTempRepository();
    try {
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'base']);
      runGit(repo.repoRoot, ['branch', 'other']);
      runGit(repo.repoRoot, ['checkout', 'other']);
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'ahead']);

      runGit(repo.repoRoot, ['checkout', 'main']);

      const result = await checkMergePreflight(repo.cli, 'other');
      assert.equal(result.wouldConflict, false);
      assert.deepEqual(result.conflictFiles, []);
    } finally {
      repo.cleanup();
    }
  });

  it('parses stdout from a real git log using the graph format', async () => {
    const repo = initTempRepository();
    try {
      const subject = 'graph-log-subject';
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', subject]);

      const result = await repo.cli.execRead(buildGraphLogArgs('HEAD', 0));
      const commits = parseGitLog(result.stdout);

      assert.ok(commits.length >= 1);
      const head = commits[0];
      assert.equal(head.subject, subject);
      assert.ok(head.sha.length >= 7);
      assert.ok(head.author.length > 0);
      assert.ok(head.authorDate > 0);
    } finally {
      repo.cleanup();
    }
  });

  it('leaves stashes, remote branches and tags out of the all-commits graph when asked, labels and commits alike', async () => {
    const repo = initTempRepository();
    try {
      const write = (name: string, text: string): void => {
        writeFileSync(join(repo.repoRoot, name), text);
      };
      write('f', 'base\n');
      runGit(repo.repoRoot, ['add', 'f']);
      runGit(repo.repoRoot, ['commit', '-m', 'base']);
      // A commit that only a remote-tracking branch reaches, one that only a tag reaches, and one stash.
      runGit(repo.repoRoot, ['checkout', '-q', '-b', 'side']);
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'only-remote']);
      runGit(repo.repoRoot, ['update-ref', 'refs/remotes/origin/side', 'HEAD']);
      runGit(repo.repoRoot, ['checkout', '-q', 'main']);
      runGit(repo.repoRoot, ['branch', '-D', 'side']);
      runGit(repo.repoRoot, ['checkout', '-q', '-b', 'old']);
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'only-tagged']);
      runGit(repo.repoRoot, ['tag', 'v-old']);
      runGit(repo.repoRoot, ['checkout', '-q', 'main']);
      runGit(repo.repoRoot, ['branch', '-D', 'old']);
      runGit(repo.repoRoot, ['tag', 'v-base']);
      write('f', 'changed\n');
      runGit(repo.repoRoot, ['stash', 'push', '-m', 'wip']);

      const walk = async (hide: { stashes?: boolean; remoteBranches?: boolean; tags?: boolean }) => {
        const stash = await repo.cli.execRead(['rev-parse', 'refs/stash']).then((r) => r.stdout.trim());
        const result = await repo.cli.execRead(buildGraphLogArgs(ALL_COMMITS_FILTER, 0, 'date', hide.stashes ? [] : [stash], false, 100, hide));
        const commits = parseGitLog(result.stdout);
        return {
          subjects: commits.map((commit) => commit.subject),
          refs: commits.flatMap((commit) => commit.refs.map((ref) => ref.kind)),
        };
      };

      const everything = await walk({});
      assert.ok(everything.subjects.includes('only-remote'));
      assert.ok(everything.subjects.includes('only-tagged'));
      assert.ok(everything.subjects.some((subject) => subject.includes('wip')));

      const noRemotes = await walk({ remoteBranches: true });
      assert.equal(noRemotes.subjects.includes('only-remote'), false);
      assert.equal(noRemotes.refs.includes('remote'), false);
      assert.ok(noRemotes.subjects.includes('only-tagged'));

      const noTags = await walk({ tags: true });
      assert.equal(noTags.subjects.includes('only-tagged'), false);
      assert.equal(noTags.refs.includes('tag'), false);

      const noStashes = await walk({ stashes: true });
      assert.equal(noStashes.subjects.some((subject) => subject.includes('wip')), false);
      assert.equal(noStashes.refs.includes('stash'), false);
      assert.ok(noStashes.subjects.includes('only-remote'));
    } finally {
      repo.cleanup();
    }
  });

  it('RefsService.loadSnapshot reads branches and tags from a real repository', async () => {
    const repo = initTempRepository();
    try {
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'init']);
      runGit(repo.repoRoot, ['branch', 'feature']);
      runGit(repo.repoRoot, ['tag', 'v0.1.0']);

      const gitRepo = mockRepository(repo.repoRoot);
      const svc = new RefsService(
        mockGitExtensionService([gitRepo], { headName: 'main' }),
        mockCliRegistry(repo.repoRoot, repo.cli),
        mockGraphService('main'),
      );

      const snapshot = await svc.loadSnapshot(repo.repoRoot);
      assert.equal(snapshot.headRef, 'main');
      assert.ok(snapshot.branches.some((b) => b.name === 'main'));
      assert.ok(snapshot.branches.some((b) => b.name === 'feature'));
      assert.ok(snapshot.tags.some((t) => t.name === 'v0.1.0'));
      assert.ok(snapshot.remotes.length === 0 || snapshot.remotes.every((r) => r.name.length > 0));
    } finally {
      repo.cleanup();
    }
  });

  it('builds sidebar folders from real branch names', async () => {
    const repo = initTempRepository();
    try {
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'init']);
      runGit(repo.repoRoot, ['branch', 'agent/issue-1']);
      runGit(repo.repoRoot, ['branch', 'agent/issue-2']);

      const svc = new RefsService(
        mockGitExtensionService([mockRepository(repo.repoRoot)], { headName: 'main' }),
        mockCliRegistry(repo.repoRoot, repo.cli),
        mockGraphService('main'),
      );
      const tree = buildSidebarTree(await svc.loadSnapshot(repo.repoRoot), {
        dirty: false,
        stagedCount: 0,
        unstagedCount: 0,
      });

      const branches = tree.find((n) => n.id === 'section:branches')?.children ?? [];
      assert.deepEqual(branches.map((n) => n.label), ['agent', 'main']);
      assert.deepEqual(branches[0].children.map((n) => n.ref), ['agent/issue-1', 'agent/issue-2']);
      assert.equal(branches[1].isHead, true);
    } finally {
      repo.cleanup();
    }
  });

  it('CommitGraphService search with --all finds commits only on other branches', async () => {
    const repo = initTempRepository();
    try {
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'init']);
      runGit(repo.repoRoot, ['checkout', '-b', 'agent/feature']);
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'only-on-feature']);
      runGit(repo.repoRoot, ['checkout', 'main']);
      const featureSha = (await repo.cli.execRead(['rev-parse', 'agent/feature'])).stdout.trim();

      const svc = new CommitGraphService(
        mockExtensionContext(),
        mockGitExtensionService([mockRepository(repo.repoRoot)], { headName: 'main' }),
        mockCliRegistry(repo.repoRoot, repo.cli),
      );

      svc.setFilterRef(repo.repoRoot, 'main');
      assert.deepEqual(await svc.findCommits(repo.repoRoot, 'only-on-feature'), []);

      svc.setFilterRef(repo.repoRoot, ALL_COMMITS_FILTER);
      assert.deepEqual(await svc.findCommits(repo.repoRoot, 'only-on-feature'), [featureSha]);
      assert.deepEqual(await svc.findCommits(repo.repoRoot, featureSha.slice(0, 10)), [featureSha]);
    } finally {
      repo.cleanup();
    }
  });

  it('CommitGraphService search filters by author, path, date and changed text, and keeps the graph row', async () => {
    const repo = initTempRepository();
    try {
      const commit = (file: string, text: string, message: string, author: string, date: string) => {
        writeFileSync(join(repo.repoRoot, file), text);
        runGit(repo.repoRoot, ['add', file]);
        runGit(repo.repoRoot, ['commit', '-m', message], {
          ...GIT_TEST_IDENTITY_ENV,
          GIT_AUTHOR_NAME: author, GIT_COMMITTER_NAME: author,
          GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date,
        });
      };
      commit('a.txt', 'one\n', 'first', 'Ada', '2024-01-10T12:00:00Z');
      commit('b.txt', 'needle\n', 'second', 'Grace', '2024-03-10T12:00:00Z');
      commit('a.txt', 'one\ntwo\n', 'third', 'Ada', '2024-06-10T12:00:00Z');
      const log = (await repo.cli.execRead(['log', '--format=%H %s'])).stdout.trim().split('\n');
      const shaOf = (subject: string) => log.find((line) => line.endsWith(subject))!.split(' ')[0];

      const svc = new CommitGraphService(
        mockExtensionContext(),
        mockGitExtensionService([mockRepository(repo.repoRoot)], { headName: 'main' }),
        mockCliRegistry(repo.repoRoot, repo.cli),
      );
      svc.setFilterRef(repo.repoRoot, 'main');
      const find = (query: string) => svc.findCommits(repo.repoRoot, query);
      assert.deepEqual(await find('author:Ada'), [shaOf('third'), shaOf('first')]);
      assert.deepEqual(await find('path:b.txt'), [shaOf('second')]);
      assert.deepEqual(await find('since:2024-02-01 until:2024-04-01'), [shaOf('second')]);
      assert.deepEqual(await find('content:needle'), [shaOf('second')]);
      assert.deepEqual(await find('author:Ada third'), [shaOf('third')]);
      assert.deepEqual(await find('author:Grace third'), []);
      const rows: { sha: string; index: number }[] = [];
      await svc.searchCommits(repo.repoRoot, 'path:b.txt', (matches) => rows.push(...matches));
      assert.deepEqual(rows, [{ sha: shaOf('second'), index: 1 }], 'the match keeps its row among all commits');
    } finally {
      repo.cleanup();
    }
  });

  it('CommitGraphService with collapsed merges lists first-parent history and loads a merge side on demand', async () => {
    const repo = initTempRepository();
    try {
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'base']);
      runGit(repo.repoRoot, ['checkout', '-b', 'topic']);
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'topic-one']);
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'topic-two']);
      runGit(repo.repoRoot, ['checkout', 'main']);
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'main-work']);
      runGit(repo.repoRoot, ['merge', '--no-ff', '--no-edit', 'topic']);
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'after-merge']);
      const merge = (await repo.cli.execRead(['rev-parse', 'HEAD~1'])).stdout.trim();

      const svc = new CommitGraphService(
        mockExtensionContext(),
        mockGitExtensionService([mockRepository(repo.repoRoot)], { headName: 'main' }),
        mockCliRegistry(repo.repoRoot, repo.cli),
      );
      svc.setFilterRef(repo.repoRoot, 'main');
      svc.setCollapseMerges(true);
      const page = await svc.loadInitial(repo.repoRoot);
      assert.deepEqual(page.commits.map((commit) => commit.subject),
        ['after-merge', `Merge branch 'topic'`, 'main-work', 'base'], 'the merged-in commits are not listed');
      assert.deepEqual((await svc.loadMergeSide(repo.repoRoot, merge)).map((commit) => commit.subject), ['topic-two', 'topic-one']);
      const rows: { sha: string; index: number }[] = [];
      await svc.searchCommits(repo.repoRoot, 'main-work', (matches) => rows.push(...matches));
      assert.deepEqual(rows.map((row) => row.index), [2], 'a match keeps the row it has in the collapsed graph');
    } finally {
      repo.cleanup();
    }
  });

  it('CommitGraphService shows a dropped commit only when reflog commits are enabled', async () => {
    const repo = initTempRepository();
    try {
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'base']);
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'dropped-from-graph']);
      const dropped = (await repo.cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();
      runGit(repo.repoRoot, ['reset', '--hard', 'HEAD~1']);
      const tree = (await repo.cli.execRead(['rev-parse', 'HEAD^{tree}'])).stdout.trim();
      const orphan = (await repo.cli.execRead(['commit-tree', tree, '-m', 'orphan-commit'])).stdout.trim();

      const svc = new CommitGraphService(
        mockExtensionContext(),
        mockGitExtensionService([mockRepository(repo.repoRoot)], { headName: 'main' }),
        mockCliRegistry(repo.repoRoot, repo.cli),
      );
      svc.setFilterRef(repo.repoRoot, ALL_COMMITS_FILTER);

      const hidden = await svc.loadInitial(repo.repoRoot);
      assert.equal(hidden.commits.some((commit) => commit.sha === dropped), false);
      assert.deepEqual(await svc.findCommits(repo.repoRoot, 'dropped-from-graph'), []);
      assert.deepEqual(await svc.findCommits(repo.repoRoot, dropped.slice(0, 8)), []);

      svc.setShowReflog(true);
      const shown = await svc.loadInitial(repo.repoRoot);
      assert.ok(shown.commits.some((commit) => commit.sha === dropped));
      assert.equal(shown.commits.find((commit) => commit.sha === dropped)?.reflogOnly, true);
      assert.equal(shown.commits.some((commit) => commit.sha !== dropped && commit.reflogOnly), false);
      assert.equal(hidden.commits.some((commit) => commit.reflogOnly), false);
      assert.equal(shown.commits.some((commit) => commit.sha === orphan), false);
      assert.deepEqual(await svc.findCommits(repo.repoRoot, 'dropped-from-graph'), [dropped]);
      assert.deepEqual(await svc.findCommits(repo.repoRoot, dropped.slice(0, 8)), [dropped]);
      assert.deepEqual(await svc.findCommits(repo.repoRoot, orphan.slice(0, 8)), []);

      svc.setFilterRef(repo.repoRoot, 'main');
      const filtered = await svc.loadInitial(repo.repoRoot);
      assert.equal(filtered.commits.some((commit) => commit.sha === dropped), false);

      svc.setActiveBranchOnly(true);
      svc.setFilterRef(repo.repoRoot, ALL_COMMITS_FILTER);
      const branchOnly = await svc.loadInitial(repo.repoRoot);
      assert.equal(branchOnly.commits.some((commit) => commit.sha === dropped), false);
    } finally {
      repo.cleanup();
    }
  });

  it('CommitGraphService.resolveReveal reports whether a ref is in the filtered history', async () => {
    const repo = initTempRepository();
    try {
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'init']);
      runGit(repo.repoRoot, ['tag', 'v1']);
      runGit(repo.repoRoot, ['checkout', '-b', 'agent/feature']);
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'feature-only']);
      runGit(repo.repoRoot, ['checkout', 'main']);
      const featureSha = (await repo.cli.execRead(['rev-parse', 'agent/feature'])).stdout.trim();

      const svc = new CommitGraphService(
        mockExtensionContext(),
        mockGitExtensionService([mockRepository(repo.repoRoot)], { headName: 'main' }),
        mockCliRegistry(repo.repoRoot, repo.cli),
      );

      svc.setFilterRef(repo.repoRoot, 'main');
      assert.equal((await svc.resolveReveal(repo.repoRoot, 'v1')).reachable, true);
      assert.deepEqual(await svc.resolveReveal(repo.repoRoot, 'agent/feature'), {
        sha: featureSha,
        reachable: false,
      });

      svc.setFilterRef(repo.repoRoot, ALL_COMMITS_FILTER);
      assert.equal((await svc.resolveReveal(repo.repoRoot, 'agent/feature')).reachable, true);
      await assert.rejects(() => svc.resolveReveal(repo.repoRoot, 'no-such-ref'));
    } finally {
      repo.cleanup();
    }
  });

  for (const [order, expectedSubjects] of [
    ['date', ['merge-feature', 'f2', 'm1', 'f1', 'base']],
    ['topo', ['merge-feature', 'f2', 'f1', 'm1', 'base']],
  ] as [GraphOrder, string[]][]) {
    it(`lays out a real merge history in ${order} order`, async () => {
      const repo = initTempRepository();
      const t = 1_700_000_000;
      try {
        commitEmptyAt(repo.repoRoot, 'base', t + 100);
        runGit(repo.repoRoot, ['checkout', '-b', 'agent/feature']);
        commitEmptyAt(repo.repoRoot, 'f1', t + 200);
        commitEmptyAt(repo.repoRoot, 'f2', t + 400);
        runGit(repo.repoRoot, ['checkout', 'main']);
        commitEmptyAt(repo.repoRoot, 'm1', t + 300);
        runGit(repo.repoRoot, ['merge', '--no-ff', '-m', 'merge-feature', 'agent/feature'], {
          ...GIT_TEST_IDENTITY_ENV,
          GIT_AUTHOR_DATE: `@${t + 500}`,
          GIT_COMMITTER_DATE: `@${t + 500}`,
        });

        const output = await repo.cli.execRead(buildGraphLogArgs('HEAD', 0, order));
        const commits = parseGitLog(output.stdout);
        assert.deepEqual(commits.map((commit) => commit.subject), expectedSubjects);
        assert.deepEqual(commits[0].refs, [{ kind: 'local', name: 'main', isHead: true }]);
        assert.deepEqual(commits[1].refs, [{ kind: 'local', name: 'agent/feature' }]);
        assert.equal(commits[0].authorEmail, 'test@git-checkout.local');

        const rows = layoutGraph(commits).rows;
        assert.equal(rows[0].bottom.length, 2, 'merge opens a second lane');
        assert.equal(Math.max(...rows.map((row) => row.width)), 2);
        for (let i = 0; i + 1 < rows.length; i++) {
          const below = [...new Set(rows[i].bottom.map((edge) => edge.to))].sort();
          const above = [...new Set(rows[i + 1].top.map((edge) => edge.from))].sort();
          assert.deepEqual(above, below, `lines between rows ${i} and ${i + 1} must connect`);
        }
        assert.deepEqual(rows[rows.length - 1].bottom, []);
      } finally {
        repo.cleanup();
      }
    });
  }
});

describe('RepoOperationService integration', () => {
  it('reports merge in progress and conflicted paths after a failed merge', async () => {
    const repo = initTempRepository();
    try {
      seedDivergentFileConflict(repo);
      const exitCode = runGitAllowFailure(repo.repoRoot, ['merge', 'other', '--no-commit']);
      assert.notEqual(exitCode, 0);

      const gitRepo = mockRepository(repo.repoRoot);
      const svc = new RepoOperationService(
        mockGitExtensionService([gitRepo]),
        mockCliRegistry(repo.repoRoot, repo.cli),
      );

      const status = await svc.getStatus(repo.repoRoot);
      assert.equal(status.active, true);
      assert.equal(status.kind, 'merge');
      assert.equal(status.conflicted, true);
      assert.ok(status.summary.includes('Merge in progress'));
      assert.ok(status.summary.includes('conflicted file'));
    } finally {
      runGitAllowFailure(repo.repoRoot, ['merge', '--abort']);
      repo.cleanup();
    }
  });
});

describe('HistoryService integration', () => {
  it('orders commits oldest-first using real committer times', async () => {
    const repo = initTempRepository();
    try {
      commitEmptyAt(repo.repoRoot, 'first', 1_000_000_000);
      commitEmptyAt(repo.repoRoot, 'second', 1_000_000_001);
      commitEmptyAt(repo.repoRoot, 'third', 1_000_000_002);

      const oldest = (
        await repo.cli.execRead(['rev-parse', 'HEAD~2'])
      ).stdout.trim();
      const middle = (
        await repo.cli.execRead(['rev-parse', 'HEAD~1'])
      ).stdout.trim();
      const newest = (await repo.cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();

      const svc = new HistoryService(mockCliRegistry(repo.repoRoot, repo.cli));
      const ordered = await svc.orderOldestFirst(repo.repoRoot, [newest, oldest, middle]);
      assert.deepEqual(ordered, [oldest, middle, newest]);
    } finally {
      repo.cleanup();
    }
  });

  it('reads parent shas from rev-list on a real repository', async () => {
    const repo = initTempRepository();
    try {
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'root']);
      const root = (await repo.cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'child']);
      const child = (await repo.cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();

      const svc = new HistoryService(mockCliRegistry(repo.repoRoot, repo.cli));
      assert.deepEqual(await svc.getParents(repo.repoRoot, root), []);
      assert.deepEqual(await svc.getParents(repo.repoRoot, child), [root]);
    } finally {
      repo.cleanup();
    }
  });
});

describe('resolveRepositoryLayout integration', () => {
  it('maps paths from a real git init layout', async () => {
    const repo = initTempRepository();
    try {
      const layout = await resolveRepositoryLayout(repo.cli, repo.repoRoot);
      assert.equal(layout.repoRoot, repo.repoRoot);
      assert.ok(layout.gitDir.includes('.git'));
      assert.equal(layout.commonDir, layout.gitDir);
      assert.ok(existsSync(layout.headPath));
      assert.ok(existsSync(layout.configPath));
      assert.equal(layout.reftableDir, null);
    } finally {
      repo.cleanup();
    }
  });
});
