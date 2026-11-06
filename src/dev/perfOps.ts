import { buildChangeNodes } from '../shared/changes/changesTree';
import { createTestGitCli } from '../core/testing/gitRepoHarness';
import { mockCliRegistry, mockExtensionContext, mockGitExtensionService, mockRepository } from '../core/testing/serviceTestUtils';
import { parseGitLog } from '../core/gitLogParser';
import { BlameService } from '../features/history/blameService';
import { buildGraphLogArgs, CommitGraphService } from '../features/graph/commitGraphService';
import { CommitTreeService } from '../features/history/commitTreeService';
import { PathHistoryService } from '../features/history/pathHistoryService';
import { layoutGraph } from '../shared/graph/graphLanes';
import { ALL_COMMITS_FILTER } from '../shared/graph/graphProtocol';
import type { GitCli } from '../core/gitCli';

/** What the operations of a benchmark run against. */
export interface PerfContext {
  root: string;
  cli: GitCli;
  graph: CommitGraphService;
  /** A file with a long history, for blame and file history. */
  file: string;
  /** The log of 20000 commits as the graph asks for it, for the work done on history once it is read. */
  log: string;
}

export interface PerfOperation {
  name: string;
  run(context: PerfContext): Promise<string | void>;
}

export async function createPerfContext(root: string, file?: string): Promise<PerfContext> {
  const cli = createTestGitCli(root);
  const head = (await cli.execRead(['symbolic-ref', '--short', 'HEAD'])).stdout.trim();
  const graph = new CommitGraphService(
    mockExtensionContext(),
    mockGitExtensionService([mockRepository(root)], { headName: head }),
    mockCliRegistry(root, cli),
  );
  const files = (await cli.execRead(['ls-files'])).stdout.split('\n');
  const log = (await cli.execRead(buildGraphLogArgs(ALL_COMMITS_FILTER, 0, 'date', [], false, 20000))).stdout;
  // The shortest path of that name is the real one, not a copy among test fixtures.
  const longHistory = files.filter((path) => /extHost\.api\.impl\.ts$/.test(path)).sort((a, b) => a.length - b.length)[0];
  return { root, cli, graph, file: file ?? longHistory ?? 'README.md', log };
}

const registryOf = (context: PerfContext) => mockCliRegistry(context.root, context.cli);

/** The operations behind the main views, each as the extension runs it. */
export const PERF_OPERATIONS: PerfOperation[] = [
  {
    name: 'graph: first page',
    async run({ graph, root }) {
      graph.reset(root);
      return `${(await graph.loadInitial(root)).commits.length} commits`;
    },
  },
  {
    name: 'graph: the next page',
    async run({ graph, root }) {
      graph.reset(root);
      await graph.loadInitial(root);
      return `${(await graph.loadMore(root)).commits.length} commits`;
    },
  },
  {
    name: 'graph: 2000 deep',
    async run({ graph, root }) {
      graph.reset(root);
      return `${(await graph.loadInitialThrough(root, 2000)).commits.length} commits`;
    },
  },
  {
    name: 'graph: refs fingerprint',
    async run({ graph, root }) {
      return `${(await graph.refsFingerprint(root)).length} chars`;
    },
  },
  {
    name: 'search: first batch of a word in messages',
    async run({ graph, root }) {
      graph.reset(root);
      await graph.loadInitial(root);
      // The search is canceled at its first match, so the time is how long a person waits to see one.
      let found = 0;
      await graph.searchCommits(root, 'terminal', (matches) => { found += matches.length; }, () => found > 0);
      return `${found} matches in the first batch`;
    },
  },
  {
    name: 'search: a word in messages',
    async run({ graph, root }) {
      graph.reset(root);
      await graph.loadInitial(root);
      return `${(await graph.findCommits(root, 'terminal')).length} matches`;
    },
  },
  {
    name: 'search: by author',
    async run({ graph, root }) {
      return `${(await graph.findCommits(root, 'author:joao')).length} matches`;
    },
  },
  {
    name: 'parse: 20000 commits of git log',
    async run({ log }) {
      return `${parseGitLog(log).length} commits`;
    },
  },
  {
    name: 'layout: lanes of 20000 commits',
    async run({ log }) {
      return `${layoutGraph(parseGitLog(log)).rows.length} rows`;
    },
  },
  {
    name: 'refs: for-each-ref of branches, tags, remotes',
    async run({ cli }) {
      return `${(await cli.execRead(['for-each-ref', '--format=%(refname)'])).stdout.split('\n').length} refs`;
    },
  },
  {
    name: 'tree: every file at HEAD',
    async run(context) {
      return `${(await new CommitTreeService(registryOf(context)).list(context.root, 'HEAD')).paths.length} paths`;
    },
  },
  {
    name: 'tree: folder tree of every path',
    async run({ cli }) {
      const paths = (await cli.execRead(['ls-tree', '-r', '-z', '--name-only', 'HEAD'])).stdout.split('\0').filter(Boolean);
      return `${buildChangeNodes(paths.map((path) => ({ path, status: 'unchanged' }) as never), true).length} top-level nodes`;
    },
  },
  {
    name: 'blame: first page of the file',
    async run(context) {
      const page = await new BlameService(registryOf(context)).loadLines(context.root, { revision: 'HEAD', path: context.file, startLine: 1 });
      return `${JSON.stringify(page).length} bytes`;
    },
  },
  {
    name: 'file history: first page',
    async run(context) {
      const page = await new PathHistoryService(registryOf(context)).loadPage(context.root, { scope: 'file', path: context.file, follow: true, includeMerges: false, skip: 0 });
      return `${page.commits.length} commits`;
    },
  },
  {
    name: 'status',
    async run({ cli }) {
      return `${(await cli.execRead(['status', '--porcelain=v1', '--branch', '--ignore-submodules=dirty'])).stdout.split('\n').length} lines`;
    },
  },
  {
    name: 'diff stat of the last commit',
    async run({ cli }) {
      return `${(await cli.execRead(['show', '--numstat', '--format=', 'HEAD'])).stdout.split('\n').length} files`;
    },
  },
];

export interface PerfTiming {
  name: string;
  ms: number[];
  note: string;
}

/** Runs `operation` `runs` times and keeps each time. */
export async function timeOperation(context: PerfContext, operation: PerfOperation, runs: number): Promise<PerfTiming> {
  const ms: number[] = [];
  let note = '';
  for (let run = 0; run < runs; run++) {
    const start = performance.now();
    note = (await operation.run(context)) ?? '';
    ms.push(performance.now() - start);
  }
  return { name: operation.name, ms, note };
}

export const median = (values: readonly number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
