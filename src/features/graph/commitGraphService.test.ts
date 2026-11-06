import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { ALL_COMMITS_FILTER } from '../../shared/graph/graphProtocol';
import {
    buildGraphLogArgs,
    CommitGraphService,
    defaultStartRef,
    namesNoRevision,
    graphIncludesReflog,
    GRAPH_PAGE_SIZE,
    commitMatchesQuery,
    parseSearchRecords,
    SEARCH_CHUNK_SIZE,
    SearchRecordParser,
} from './commitGraphService';
import { GitCliError } from '../../core/gitCliError';
import { defaultGitCheckoutSettings } from '../../core/gitCheckoutSettings';
import {
    mockCliRegistry,
    mockExtensionContext,
    mockGitCli,
    mockGitExtensionService,
    mockRepository,
} from '../../core/testing/serviceTestUtils';

const REPO = '/repo';

/** The git log of a search, told from the other reads by the fields it asks for. */
const isSearchScan = (args: string[]): boolean => args[0] === 'log' && args.some((arg) => arg.includes('%B%x01'));
const FILTER_KEY = 'gitCheckout.graph.filter';

function fakeLogPage(count: number): string {
  const records: string[] = [];
  for (let i = 0; i < count; i++) {
    records.push(
      [`sha${i}`, '', `commit ${i}`, 'Author', 'author@x', '1700000000', ''].join('\0'),
    );
  }
  return records.join('\0');
}

function sha(index: number): string {
  return index.toString(16).padStart(40, '0');
}

function searchLog(entries: { sha: string; author?: string; message: string }[]): string {
  return entries
    .map((entry) => `${entry.sha}\0${entry.author ?? 'Ann'}\0ann@example.com\0${entry.message}\n\x01`)
    .join('\n');
}

describe('a graph filter that no longer exists', () => {
  const missing = new GitCliError('ExitCode', 'git exited with code 128', REPO, "fatal: ambiguous argument 'gone': unknown revision or path not in the working tree.", 128);

  it('falls back to all commits, and remembers it', async () => {
    const context = mockExtensionContext({ [FILTER_KEY]: { [REPO]: 'gone' } });
    const { cli, reads } = mockGitCli({
      execRead: async (args) => {
        if (args.includes('gone')) {
          throw missing;
        }
        return { stdout: fakeLogPage(3) };
      },
    });
    const svc = new CommitGraphService(
      context,
      mockGitExtensionService([mockRepository(REPO)], { headName: 'main' }),
      mockCliRegistry(REPO, cli),
    );
    const page = await svc.loadInitial(REPO);
    assert.equal(page.filterRef, ALL_COMMITS_FILTER);
    assert.equal(page.commits.length, 3);
    assert.equal(svc.getFilterRef(REPO), ALL_COMMITS_FILTER);
    assert.equal(reads.filter((args) => args[0] === 'log').length, 2, 'one failed read, then one for all commits');
  });

  it('does not hide other failures, or a failure of all commits itself', async () => {
    const failing = (error: Error, filter: string) => {
      const { cli } = mockGitCli({ execRead: async (args) => { if (args[0] === 'log') { throw error; } return { stdout: '' }; } });
      return new CommitGraphService(
        mockExtensionContext({ [FILTER_KEY]: { [REPO]: filter } }),
        mockGitExtensionService([mockRepository(REPO)], { headName: 'main' }),
        mockCliRegistry(REPO, cli),
      ).loadInitial(REPO);
    };
    const lock = new GitCliError('Lock', 'locked', REPO, 'fatal: Unable to create index.lock', 128);
    await assert.rejects(() => failing(lock, 'gone'), /locked/);
    await assert.rejects(() => failing(missing, ALL_COMMITS_FILTER), /code 128/);
  });

  it('counts only a missing revision', () => {
    assert.equal(namesNoRevision(missing), true);
    assert.equal(namesNoRevision(new GitCliError('ExitCode', 'x', REPO, 'fatal: bad revision', 128)), true);
    assert.equal(namesNoRevision(new GitCliError('ExitCode', 'x', REPO, 'fatal: not a git repository', 128)), false);
    assert.equal(namesNoRevision(new Error('ambiguous argument')), false);
  });
});

describe('CommitGraphService with a revision that is an option', () => {
  it('refuses it without running Git', async () => {
    const { cli, reads } = mockGitCli();
    const svc = new CommitGraphService(
      mockExtensionContext(),
      mockGitExtensionService([mockRepository(REPO)], { headName: 'main' }),
      mockCliRegistry(REPO, cli),
    );
    await assert.rejects(() => svc.resolveReveal(REPO, '-n1'), /Not a valid revision/);
    await assert.rejects(() => svc.loadCommit(REPO, '--version'), /Not a valid revision/);
    await assert.rejects(() => svc.loadMergeSide(REPO, '--help'), /Not a valid revision/);
    assert.deepEqual(reads.filter((args) => args[0] !== 'config'), []);
  });
});

describe('SearchRecordParser', () => {
  const entries = [
    { sha: sha(1), author: 'Ann Lee', message: 'Fix one\n\nWith a body' },
    { sha: sha(2), message: 'Two' },
    { sha: sha(3), message: '' },
  ];
  const output = searchLog(entries);

  it('gives the same commits however the output is cut, even inside a record or a separator', () => {
    const whole = parseSearchRecords(output);
    assert.equal(whole.length, 3);
    for (const size of [1, 2, 7, 41, 100, output.length]) {
      const parser = new SearchRecordParser();
      const records = [];
      for (let at = 0; at < output.length; at += size) {
        records.push(...parser.push(output.slice(at, at + size)));
      }
      records.push(...parser.end());
      assert.deepEqual(records, whole, `cut every ${size} characters`);
    }
  });

  it('holds back a commit until its end is seen', () => {
    const parser = new SearchRecordParser();
    assert.deepEqual(parser.push(output.slice(0, 30)), []);
    assert.equal(parser.push(output.slice(30)).length, 3);
    assert.deepEqual(parser.end(), []);
  });

  it('gives nothing for empty output', () => {
    const parser = new SearchRecordParser();
    assert.deepEqual([...parser.push(''), ...parser.end()], []);
  });
});

describe('search matching', () => {
  const [record] = parseSearchRecords(searchLog([{ sha: sha(1), author: 'Ann Lee', message: 'Fix the BUG\n\nDetails' }]));

  it('parses multi-line messages and skips malformed records', () => {
    assert.equal(record.message, 'Fix the BUG\n\nDetails');
    assert.deepEqual(parseSearchRecords('nope\x01\n\x01'), []);
  });

  it('matches message, author, and hash prefix without regard to case', () => {
    assert.ok(commitMatchesQuery(record, 'the bug'));
    assert.ok(commitMatchesQuery(record, 'details'));
    assert.ok(commitMatchesQuery(record, 'ann lee'));
    assert.ok(commitMatchesQuery(record, 'ann@example'));
    assert.ok(commitMatchesQuery(record, sha(1).slice(0, 12)));
    assert.ok(!commitMatchesQuery(record, 'ffff'));
    assert.ok(!commitMatchesQuery(record, '   '));
  });
});

describe('buildGraphLogArgs', () => {
  it('includes skip when loading additional pages', () => {
    const args = buildGraphLogArgs('main', 80);
    assert.equal(args[0], 'log');
    assert.equal(args[2], String(GRAPH_PAGE_SIZE));
    assert.equal(args[args.length - 1], '--skip=80');
    assert.equal(args.includes('main'), true);
  });

  it('omits skip for the first page', () => {
    const args = buildGraphLogArgs('HEAD', 0);
    assert.equal(args.includes('--skip=0'), false);
    assert.deepEqual(args[args.length - 1], 'HEAD');
  });

  it('orders by date unless topological order is requested', () => {
    assert.ok(buildGraphLogArgs('HEAD', 0).includes('--date-order'));
    const topo = buildGraphLogArgs('HEAD', 0, 'topo');
    assert.ok(topo.includes('--topo-order'));
    assert.equal(topo.includes('--date-order'), false);
  });

  it('requests full ref names so ref kinds can be told apart', () => {
    assert.ok(buildGraphLogArgs('HEAD', 0).includes('--decorate=full'));
  });

  it('includes stash commits when showing all commits', () => {
    const sha = 'a'.repeat(40);
    const args = buildGraphLogArgs(ALL_COMMITS_FILTER, 80, 'date', [sha]);
    assert.ok(args.includes(ALL_COMMITS_FILTER));
    assert.ok(args.includes(sha));
    assert.ok(args.indexOf(sha) < args.indexOf('--skip=80'));
    assert.equal(args.includes('--reflog'), false);
  });

  it('leaves hidden kinds of refs out of the walk and their labels off the commits', () => {
    const args = buildGraphLogArgs(ALL_COMMITS_FILTER, 0, 'date', [], false, GRAPH_PAGE_SIZE, {
      stashes: true,
      remoteBranches: true,
      tags: true,
    });
    for (const pattern of ['refs/stash', 'refs/remotes/*', 'refs/tags/*']) {
      assert.ok(args.includes(`--exclude=${pattern}`), pattern);
      assert.ok(args.includes(`--decorate-refs-exclude=${pattern}`), pattern);
      // --exclude only applies to the ref selector that follows it.
      assert.ok(args.indexOf(`--exclude=${pattern}`) < args.indexOf(ALL_COMMITS_FILTER));
    }
  });

  it('leaves single hidden refs out of the walk and their labels off the commits', () => {
    const args = buildGraphLogArgs(ALL_COMMITS_FILTER, 0, 'date', [], false, 50, { refs: ['refs/heads/topic', 'refs/remotes/origin/old'] });
    for (const ref of ['refs/heads/topic', 'refs/remotes/origin/old']) {
      assert.ok(args.includes(`--decorate-refs-exclude=${ref}`), ref);
      assert.ok(args.includes(`--exclude=${ref}`), ref);
    }
  });

  it('hides only the kinds that were asked for, and does not exclude from a walk of one branch', () => {
    const tagsOnly = buildGraphLogArgs(ALL_COMMITS_FILTER, 0, 'date', [], false, GRAPH_PAGE_SIZE, { tags: true });
    assert.deepEqual(tagsOnly.filter((arg) => arg.includes('refs/')), ['--decorate-refs-exclude=refs/tags/*', '--exclude=refs/tags/*']);
    assert.equal(buildGraphLogArgs(ALL_COMMITS_FILTER, 0).some((arg) => arg.includes('refs/')), false);

    const branch = buildGraphLogArgs('main', 0, 'date', [], false, GRAPH_PAGE_SIZE, { remoteBranches: true });
    assert.equal(branch.includes('--exclude=refs/remotes/*'), false);
    assert.ok(branch.includes('--decorate-refs-exclude=refs/remotes/*'));
  });

  it('adds --reflog ahead of the revision when lost commits are requested', () => {
    const args = buildGraphLogArgs(ALL_COMMITS_FILTER, 0, 'date', [], true);
    assert.ok(args.includes('--reflog'));
    assert.ok(args.indexOf('--reflog') < args.indexOf(ALL_COMMITS_FILTER));
    assert.equal(graphIncludesReflog(ALL_COMMITS_FILTER, true), true);
    assert.equal(graphIncludesReflog('main', true), false);
    assert.equal(graphIncludesReflog(ALL_COMMITS_FILTER, false), false);
  });
});

describe('CommitGraphService', () => {
  it('loads an initial page and reports hasMore when the page is full', async () => {
    let call = 0;
    const { cli } = mockGitCli({
      execRead: async () => {
        call += 1;
        return { stdout: fakeLogPage(GRAPH_PAGE_SIZE) };
      },
    });
    const context = mockExtensionContext({
      [FILTER_KEY]: { [REPO]: 'main' },
    });
    const svc = new CommitGraphService(
      context,
      mockGitExtensionService([mockRepository(REPO)], { headName: 'main' }),
      mockCliRegistry(REPO, cli),
    );

    const page = await svc.loadInitial(REPO);
    assert.equal(page.commits.length, GRAPH_PAGE_SIZE);
    assert.equal(page.hasMore, true);
    assert.equal(page.filterRef, 'main');
    assert.equal(page.activeBranchOnly, false);
    assert.equal(page.collapseMerges, false);
    assert.equal(call, 3);
  });

  it('passes skip to git log on loadMore', async () => {
    const reads: string[][] = [];
    const { cli } = mockGitCli({
      execRead: async (args) => {
        reads.push(args);
        const skip = args.find((a) => a.startsWith('--skip='));
        if (!skip) {
          return { stdout: fakeLogPage(GRAPH_PAGE_SIZE) };
        }
        return { stdout: fakeLogPage(3) };
      },
    });
    const context = mockExtensionContext({
      [FILTER_KEY]: { [REPO]: 'main' },
    });
    const svc = new CommitGraphService(
      context,
      mockGitExtensionService([mockRepository(REPO)], { headName: 'main' }),
      mockCliRegistry(REPO, cli),
    );

    await svc.loadInitial(REPO);
    const more = await svc.loadMore(REPO);
    assert.equal(more.commits.length, 3);
    assert.equal(more.hasMore, false);
    assert.ok(reads.some((args) => args.includes('--skip=80')));
  });

  it('reloads through a depth with one git log, rounded up to whole pages, and reports how much is loaded', async () => {
    const reads: string[][] = [];
    const { cli } = mockGitCli({
      execRead: async (args) => {
        reads.push(args);
        // History ends partway through the second page.
        return { stdout: fakeLogPage(GRAPH_PAGE_SIZE + 3) };
      },
    });
    const svc = new CommitGraphService(
      mockExtensionContext({ [FILTER_KEY]: { [REPO]: 'main' } }),
      mockGitExtensionService([mockRepository(REPO)], { headName: 'main' }),
      mockCliRegistry(REPO, cli),
    );
    assert.equal(svc.loadedCount(REPO), 0);
    const page = await svc.loadInitialThrough(REPO, GRAPH_PAGE_SIZE + 1);
    const logs = reads.filter((args) => args[0] === 'log');
    assert.equal(logs.length, 1, 'one git log, not one per page');
    assert.equal(logs[0][logs[0].indexOf('-n') + 1], String(GRAPH_PAGE_SIZE * 2));
    assert.equal(logs[0].some((arg) => arg.startsWith('--skip=')), false);
    assert.equal(page.commits.length, GRAPH_PAGE_SIZE + 3);
    assert.equal(page.hasMore, false);
    assert.equal(svc.loadedCount(REPO), GRAPH_PAGE_SIZE + 3);
  });

  const searchService = (stdout: () => string): { svc: CommitGraphService; reads: string[][] } => {
    const { cli, reads } = mockGitCli({ execRead: async () => ({ stdout: stdout() }) });
    const svc = new CommitGraphService(
      mockExtensionContext({ [FILTER_KEY]: { [REPO]: 'main' } }),
      mockGitExtensionService([mockRepository(REPO)], { headName: 'main' }),
      mockCliRegistry(REPO, cli),
    );
    return { svc, reads };
  };

  it('streams matches in graph order, a chunk of commits at a time, from one git process', async () => {
    const history = Array.from({ length: SEARCH_CHUNK_SIZE }, (_, i) => ({
      sha: sha(i), message: i === 5 ? 'fix one' : 'other',
    })).concat([{ sha: sha(5000), message: 'fix two' }, { sha: sha(5001), message: 'other' }]);
    const { svc, reads } = searchService(() => searchLog(history));

    const batches: [{ sha: string; index: number }[], boolean][] = [];
    await svc.searchCommits(REPO, ' FIX ', (matches, done) => batches.push([matches, done]));
    assert.deepEqual(batches, [
      [[{ sha: sha(5), index: 5 }], false],
      [[{ sha: sha(5000), index: SEARCH_CHUNK_SIZE }], true],
    ]);
    const scans = reads.filter(isSearchScan);
    assert.equal(scans.length, 1, 'one git log for the whole scan');
    assert.ok(scans.every((args) => args[args.length - 1] === 'main'));
    assert.equal(scans[0].some((arg) => arg.startsWith('--skip=') || arg === '-n'), false, 'no walking again per chunk');
    assert.deepEqual(await svc.findCommits(REPO, 'fix'), [sha(5), sha(5000)]);
    assert.deepEqual(await svc.findCommits(REPO, '  '), []);
  });

  it('says it is done even when history ends exactly on a chunk', async () => {
    const { svc } = searchService(() => searchLog(Array.from({ length: SEARCH_CHUNK_SIZE }, (_, i) => ({ sha: sha(i), message: 'fix' }))));
    const batches: [number, boolean][] = [];
    await svc.searchCommits(REPO, 'fix', (matches, done) => batches.push([matches.length, done]));
    assert.deepEqual(batches, [[SEARCH_CHUNK_SIZE, false], [0, true]]);
  });

  it('stops reading once the search is cancelled, without another batch', async () => {
    let delivered = 0;
    const { cli, reads } = mockGitCli({
      execRead: async () => ({ stdout: searchLog(Array.from({ length: SEARCH_CHUNK_SIZE * 2 }, (_, i) => ({ sha: sha(i), message: 'fix' }))) }),
    });
    const svc = new CommitGraphService(
      mockExtensionContext({ [FILTER_KEY]: { [REPO]: 'main' } }),
      mockGitExtensionService([mockRepository(REPO)], { headName: 'main' }),
      mockCliRegistry(REPO, cli),
    );
    let stop = false;
    const seen: number[] = [];
    await svc.searchCommits(REPO, 'fix', (matches) => { delivered += 1; seen.push(matches.length); stop = true; }, () => stop);
    assert.deepEqual(seen, [SEARCH_CHUNK_SIZE]);
    assert.equal(delivered, 1);
    assert.equal(reads.filter(isSearchScan).length, 1);
  });

  it('does not start when it is cancelled already', async () => {
    const { svc } = searchService(() => searchLog([{ sha: sha(1), message: 'fix' }]));
    const seen: unknown[] = [];
    await svc.searchCommits(REPO, 'fix', (matches) => seen.push(matches), () => true);
    assert.deepEqual(seen, []);
  });

  it('defaults to all commits and keeps a chosen filter when HEAD moves', async () => {
    const { cli } = mockGitCli({ execRead: async () => ({ stdout: '' }) });
    const head = { headName: 'main' as string | null };
    const svc = new CommitGraphService(
      mockExtensionContext(),
      mockGitExtensionService([mockRepository(REPO)], head),
      mockCliRegistry(REPO, cli),
    );

    assert.equal((await svc.loadInitial(REPO)).filterRef, ALL_COMMITS_FILTER);

    svc.setFilterRef(REPO, 'feature');
    head.headName = 'release';
    assert.equal((await svc.loadInitial(REPO)).filterRef, 'feature');
  });

  it('adds Gravatar URLs only when the setting is on', async () => {
    const record = ['sha1', '', 'subject', 'Alice', 'alice@example.com', '100', ''].join('\0');
    const { cli } = mockGitCli({ execRead: async () => ({ stdout: record }) });
    const load = async (gravatar: boolean) => {
      const svc = new CommitGraphService(
        mockExtensionContext(),
        mockGitExtensionService([mockRepository(REPO)], { headName: 'main' }),
        mockCliRegistry(REPO, cli),
        { ...defaultGitCheckoutSettings, graphGravatar: () => gravatar },
      );
      return (await svc.loadInitial(REPO)).commits[0];
    };

    assert.equal((await load(false)).avatarUrl, undefined);
    assert.match((await load(true)).avatarUrl ?? '', /^https:\/\/www\.gravatar\.com\/avatar\/[0-9a-f]{64}\?/);
  });

  it('passes --all to git log for the All Commits filter', async () => {
    const reads: string[][] = [];
    const { cli } = mockGitCli({
      execRead: async (args) => {
        reads.push(args);
        return { stdout: '' };
      },
    });
    const svc = new CommitGraphService(
      mockExtensionContext(),
      mockGitExtensionService([mockRepository(REPO)], { headName: 'main' }),
      mockCliRegistry(REPO, cli),
    );

    svc.setFilterRef(REPO, ALL_COMMITS_FILTER);
    const page = await svc.loadInitial(REPO);
    assert.equal(page.filterRef, ALL_COMMITS_FILTER);
    const logArgs = reads.find((args) => args[0] === 'log');
    assert.ok(logArgs);
    assert.ok(logArgs.includes(ALL_COMMITS_FILTER));
  });

  it('loads through a distant position in one git call', async () => {
    const reads: string[][] = [];
    const { cli } = mockGitCli({
      execRead: async (args) => {
        reads.push(args);
        return { stdout: fakeLogPage(args.includes('--skip=80') ? 2000 : GRAPH_PAGE_SIZE) };
      },
    });
    const svc = new CommitGraphService(
      mockExtensionContext({ [FILTER_KEY]: { [REPO]: 'main' } }),
      mockGitExtensionService([mockRepository(REPO)], { headName: 'main' }),
      mockCliRegistry(REPO, cli),
    );
    await svc.loadInitial(REPO);
    const page = await svc.loadThroughIndex(REPO, 1500);
    assert.equal(page.commits.length, 2000);
    const jump = reads.find((args) => args.includes('--skip=80'));
    assert.ok(jump);
    assert.equal(jump[jump.indexOf('-n') + 1], String(1500 + 1 + GRAPH_PAGE_SIZE - 80));
  });

  it('finds a commit by hash prefix while scanning all commits', async () => {
    const { cli } = mockGitCli({
      execRead: async () => ({ stdout: searchLog([{ sha: 'abcd'.padEnd(40, '1'), message: 'x' }, { sha: sha(2), message: 'y' }]) }),
    });
    const svc = new CommitGraphService(
      mockExtensionContext(),
      mockGitExtensionService([mockRepository(REPO)], { headName: 'main' }),
      mockCliRegistry(REPO, cli),
    );

    svc.setFilterRef(REPO, ALL_COMMITS_FILTER);
    assert.deepEqual(await svc.findCommits(REPO, 'abcd'), ['abcd'.padEnd(40, '1')]);
  });
});

describe('show reflog commits', () => {
  it('defaults off and passes --reflog only for the all-commits walk', async () => {
    const reads: string[][] = [];
    const { cli } = mockGitCli({
      execRead: async (args) => {
        reads.push(args);
        return { stdout: '' };
      },
    });
    const context = mockExtensionContext({
      [FILTER_KEY]: { [REPO]: ALL_COMMITS_FILTER },
    });
    const saved: boolean[] = [];
    const svc = new CommitGraphService(
      context,
      mockGitExtensionService([mockRepository(REPO)], { headName: 'main' }),
      mockCliRegistry(REPO, cli),
      { ...defaultGitCheckoutSettings, setGraphShowReflog: async (enabled) => { saved.push(enabled); } },
    );

    await svc.loadInitial(REPO);
    const hidden = reads.find((args) => args[0] === 'log' && args.includes('--decorate=full'));
    assert.ok(hidden);
    assert.equal(hidden.includes('--reflog'), false);

    svc.setShowReflog(true);
    assert.deepEqual(saved, [true]);
    reads.length = 0;
    await svc.loadInitial(REPO);
    const shown = reads.find((args) => args[0] === 'log' && args.includes('--decorate=full'));
    assert.ok(shown);
    assert.ok(shown.includes('--reflog'));
    assert.ok(shown.indexOf('--reflog') < shown.indexOf(ALL_COMMITS_FILTER));

    svc.setFilterRef(REPO, 'feature');
    reads.length = 0;
    await svc.loadInitial(REPO);
    const filtered = reads.find((args) => args[0] === 'log' && args.includes('--decorate=full'));
    assert.ok(filtered);
    assert.equal(filtered.includes('--reflog'), false);
    assert.ok(filtered.includes('feature'));

    svc.setShowReflog(false);
    assert.deepEqual(saved, [true, false]);
    assert.equal(svc.isShowReflog(), false);
  });

  it('flags only reflog-only commits and keeps stash tips out of that set', async () => {
    const KEEP = 'a'.repeat(40);
    const LOST = 'b'.repeat(40);
    const STASH = 'c'.repeat(40);
    const row = (sha: string, subject: string) =>
      [sha, '', subject, 'An Author', 'a@example.test', '1700000000', ''].join('\0') + '\0';
    const reads: string[][] = [];
    const { cli } = mockGitCli({
      execRead: async (args) => {
        reads.push(args);
        if (args[0] === 'stash') {
          return { stdout: ['stash@{0}', STASH, 'WIP on main: x'].join('\0') + '\0' };
        }
        if (args[0] === 'rev-list') {
          return { stdout: `${LOST}\n` };
        }
        return { stdout: [row(KEEP, 'kept'), row(LOST, 'lost'), row(STASH, 'WIP')].join('\n') };
      },
    });
    const svc = new CommitGraphService(
      mockExtensionContext({ [FILTER_KEY]: { [REPO]: ALL_COMMITS_FILTER } }),
      mockGitExtensionService([mockRepository(REPO)], { headName: 'main' }),
      mockCliRegistry(REPO, cli),
      { ...defaultGitCheckoutSettings, graphShowReflog: () => true },
    );

    const page = await svc.loadInitial(REPO);
    assert.deepEqual(page.commits.map((commit) => commit.reflogOnly === true), [false, true, false]);
    assert.deepEqual(reads.find((args) => args[0] === 'rev-list'), ['rev-list', '--reflog', '--not', '--all', STASH]);
  });

  it('does not look for reflog-only commits while reflog mode is off', async () => {
    const reads: string[][] = [];
    const { cli } = mockGitCli({
      execRead: async (args) => {
        reads.push(args);
        return { stdout: '' };
      },
    });
    const svc = new CommitGraphService(
      mockExtensionContext({ [FILTER_KEY]: { [REPO]: ALL_COMMITS_FILTER } }),
      mockGitExtensionService([mockRepository(REPO)], { headName: 'main' }),
      mockCliRegistry(REPO, cli),
    );
    await svc.loadInitial(REPO);
    assert.equal(reads.some((args) => args[0] === 'rev-list'), false);
  });

  it('asks for no stash entries, and hides the kinds the settings turn off', async () => {
    const reads: string[][] = [];
    const { cli } = mockGitCli({
      execRead: async (args) => {
        reads.push(args);
        return { stdout: '' };
      },
    });
    const svc = new CommitGraphService(
      mockExtensionContext({ [FILTER_KEY]: { [REPO]: ALL_COMMITS_FILTER } }),
      mockGitExtensionService([mockRepository(REPO)], { headName: 'main' }),
      mockCliRegistry(REPO, cli),
      {
        ...defaultGitCheckoutSettings,
        graphShowStashes: () => false,
        graphShowRemoteBranches: () => false,
        graphShowTags: () => false,
      },
    );
    await svc.loadInitial(REPO);
    assert.equal(reads.some((args) => args[0] === 'stash'), false, 'the stash list is not even read');
    const log = reads.find((args) => args[0] === 'log');
    assert.ok(log?.includes('--exclude=refs/stash'));
    assert.ok(log?.includes('--exclude=refs/remotes/*'));
    assert.ok(log?.includes('--exclude=refs/tags/*'));
  });

  it('shows stashes, remote branches and tags unless a setting turns them off', async () => {
    const reads: string[][] = [];
    const { cli } = mockGitCli({
      execRead: async (args) => {
        reads.push(args);
        return { stdout: '' };
      },
    });
    const svc = new CommitGraphService(
      mockExtensionContext({ [FILTER_KEY]: { [REPO]: ALL_COMMITS_FILTER } }),
      mockGitExtensionService([mockRepository(REPO)], { headName: 'main' }),
      mockCliRegistry(REPO, cli),
    );
    await svc.loadInitial(REPO);
    assert.ok(reads.some((args) => args[0] === 'stash'));
    assert.equal(reads.find((args) => args[0] === 'log')?.some((arg) => arg.includes('refs/')), false);
  });

  it('reads the show reflog setting and drops the toggled value when the setting changes', () => {
    let configured = true;
    const svc = new CommitGraphService(
      mockExtensionContext(),
      mockGitExtensionService([mockRepository(REPO)], { headName: 'main' }),
      mockCliRegistry(REPO, mockGitCli().cli),
      { ...defaultGitCheckoutSettings, graphShowReflog: () => configured },
    );
    assert.equal(svc.isShowReflog(), true);
    svc.setShowReflog(false);
    assert.equal(svc.isShowReflog(), false);
    configured = true;
    svc.onShowReflogSettingChanged();
    assert.equal(svc.isShowReflog(), true);
  });

  it('scans reflog commits only while the option is on', async () => {
    const reads: string[][] = [];
    const { cli } = mockGitCli({
      execRead: async (args) => {
        reads.push(args);
        return { stdout: '' };
      },
    });
    const svc = new CommitGraphService(
      mockExtensionContext({ [FILTER_KEY]: { [REPO]: ALL_COMMITS_FILTER } }),
      mockGitExtensionService([mockRepository(REPO)], { headName: 'main' }),
      mockCliRegistry(REPO, cli),
    );
    const scan = () => reads.filter(isSearchScan);

    await svc.findCommits(REPO, 'abcd');
    assert.equal(scan().some((args) => args.includes('--reflog')), false);

    svc.setShowReflog(true);
    await svc.findCommits(REPO, 'abcd');
    assert.ok(scan().some((args) => args.includes('--reflog')));
  });

  it('searches the checked-out branch while the mode is on', async () => {
    const reads: string[][] = [];
    const { cli } = mockGitCli({
      execRead: async (args) => {
        reads.push(args);
        return { stdout: '' };
      },
    });
    const svc = new CommitGraphService(
      mockExtensionContext({ [FILTER_KEY]: { [REPO]: 'feature' } }),
      mockGitExtensionService([mockRepository(REPO)], { headName: 'main' }),
      mockCliRegistry(REPO, cli),
    );
    svc.setActiveBranchOnly(true);
    await svc.findCommits(REPO, 'fix');
    const scans = reads.filter(isSearchScan);
    assert.ok(scans.length > 0);
    assert.ok(scans.every((args) => args[args.length - 1] === 'main'));
  });
});

describe('defaultStartRef', () => {
  it('uses the filter ref, or HEAD when showing all commits', () => {
    assert.equal(defaultStartRef('feature', 'main'), 'feature');
    assert.equal(defaultStartRef(ALL_COMMITS_FILTER, 'main'), 'main');
    assert.equal(defaultStartRef(ALL_COMMITS_FILTER, null), 'HEAD');
  });
});

describe('CommitGraphService.resolveHeadRef', () => {
  const twoRepositories = {
    getDiagnostics: () => ({
      repositories: [
        { rootPath: '/work/maccy', headName: 'appstore' },
        { rootPath: '/work/hycross', headName: 'main' },
      ],
    }),
  };

  it('is the branch checked out in the repository asked about, not the first repository', () => {
    const svc = new CommitGraphService(
      mockExtensionContext(),
      twoRepositories as never,
      mockCliRegistry(REPO, mockGitCli().cli),
    );
    assert.equal(svc.resolveHeadRef('/work/hycross'), 'main');
    assert.equal(svc.resolveHeadRef('/work/maccy'), 'appstore');
    assert.equal(svc.resolveHeadRef('/work/unknown'), null);
    assert.equal(svc.resolveHeadRef(), 'appstore');
  });
});

describe('CommitGraphService.currentBranch', () => {
  const unread = { getDiagnostics: () => ({ repositories: [{ rootPath: REPO, headName: null }] }) };

  it('uses the branch vscode.git reports without asking Git', async () => {
    const { cli, reads } = mockGitCli();
    const known = { getDiagnostics: () => ({ repositories: [{ rootPath: REPO, headName: 'main' }] }) };
    const svc = new CommitGraphService(mockExtensionContext(), known as never, mockCliRegistry(REPO, cli));
    assert.equal(await svc.currentBranch(REPO), 'main');
    assert.deepEqual(reads, []);
  });

  it('asks Git when vscode.git has not read HEAD yet, and is null when detached', async () => {
    const named = mockGitCli({ execRead: async () => ({ stdout: 'main\n' }) });
    const svc = new CommitGraphService(mockExtensionContext(), unread as never, mockCliRegistry(REPO, named.cli));
    assert.equal(await svc.currentBranch(REPO), 'main');
    assert.deepEqual(named.reads, [['branch', '--show-current']]);

    const detached = mockGitCli({ execRead: async () => ({ stdout: '\n' }) });
    const other = new CommitGraphService(mockExtensionContext(), unread as never, mockCliRegistry(REPO, detached.cli));
    assert.equal(await other.currentBranch(REPO), null);
  });
});
