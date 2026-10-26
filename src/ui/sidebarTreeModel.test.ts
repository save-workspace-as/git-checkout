import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import type { RefsSnapshotDto } from '../shared/branches/refsProtocol';
import type { GitSubmoduleDto } from '../shared/submodules/submoduleProtocol';
import type { GitWorktreeDto } from '../shared/worktrees/worktreeProtocol';
import {
    assignRepoRoot,
    buildSidebarTree,
    dropIntent,
    formatUpstreamTrack,
    pickCompareBranches,
    pickStashSelectors,
    pickSubmodulePaths,
    repositoryBranchLabel,
    SIDEBAR_COMMANDS,
    SIDEBAR_CONTEXT,
    SIDEBAR_REPO_SLOTS,
    SIDEBAR_VIEW_ID,
    sidebarViewId,
    type SidebarNode,
    treeItemSpec,
    withSidebarSearch,
} from './sidebarTreeModel';

const CLEAN = { dirty: false, stagedCount: 0, unstagedCount: 0 };

function snapshot(partial: Partial<RefsSnapshotDto> = {}): RefsSnapshotDto {
  return {
    branches: [],
    remoteBranches: [],
    tags: [],
    remotes: [],
    filterRef: 'HEAD',
    headRef: null,
    ...partial,
  };
}

function section(nodes: SidebarNode[], id: string): SidebarNode {
  const found = nodes.find((n) => n.id === id);
  assert.ok(found, `missing ${id}`);
  return found;
}

function labels(nodes: SidebarNode[]): string[] {
  return nodes.map((n) => n.label);
}

function allNodes(nodes: SidebarNode[]): SidebarNode[] {
  return nodes.flatMap((n) => [n, ...allNodes(n.children)]);
}

describe('formatUpstreamTrack', () => {
  const cases: [string | null, string][] = [
    [null, ''],
    ['', ''],
    ['[ahead 1]', '1↑'],
    ['[behind 5]', '5↓'],
    ['[ahead 1, behind 5]', '5↓ 1↑'],
    ['[gone]', 'gone'],
  ];
  for (const [input, expected] of cases) {
    it(`formats ${JSON.stringify(input)}`, () => {
      assert.equal(formatUpstreamTrack(input), expected);
    });
  }
});

describe('repository views', () => {
  it('labels a view with the repository folder and checked-out branch', () => {
    assert.equal(repositoryBranchLabel('refs/heads/main'), 'main');
    assert.equal(repositoryBranchLabel('feature'), 'feature');
    assert.equal(repositoryBranchLabel(null), undefined);
  });

  it('tags every row below a section with the repository root', () => {
    const sections = buildSidebarTree(snapshot(), CLEAN);
    for (const node of sections) {
      assignRepoRoot(node, '/work/demo');
    }
    const visit = (row: SidebarNode): void => {
      assert.equal(row.repoRoot, '/work/demo', row.id);
      row.children.forEach(visit);
    };
    sections.forEach(visit);
  });

  it('gives the first view the base id and each later slot its own id', () => {
    assert.equal(sidebarViewId(0), SIDEBAR_VIEW_ID);
    const ids = Array.from({ length: SIDEBAR_REPO_SLOTS }, (_, slot) => sidebarViewId(slot));
    assert.equal(new Set(ids).size, SIDEBAR_REPO_SLOTS);
    assert.equal(sidebarViewId(3), `${SIDEBAR_VIEW_ID}.3`);
  });
});

describe('buildSidebarTree', () => {
  it('returns the fixed top-level entries in order', () => {
    const tree = buildSidebarTree(snapshot(), CLEAN);
    assert.deepEqual(labels(tree), [
      'Changes',
      'History',
      'Branches',
      'Remotes',
      'Tags',
      'Stashes',
      'Worktrees',
      'Submodules',
    ]);
  });

  it('shows the changed-file count on Changes only when dirty', () => {
    assert.equal(buildSidebarTree(snapshot(), CLEAN)[0].description, undefined);
    const dirty = { dirty: true, stagedCount: 2, unstagedCount: 1 };
    assert.equal(buildSidebarTree(snapshot(), dirty)[0].description, '3');
  });

  it('has no file rows under Changes: the Changes tab lists them', () => {
    const local = buildSidebarTree(snapshot(), { dirty: true, stagedCount: 1, unstagedCount: 2 })[0];
    assert.equal(local.children.length, 0);
    assert.equal(treeItemSpec(local).collapsible, 'none');
    assert.equal(treeItemSpec(local).command?.id, SIDEBAR_COMMANDS.showLocalChanges);
  });

  it('nests branches into folders, folders first and sorted', () => {
    const tree = buildSidebarTree(
      snapshot({
        branches: [
          { name: 'main', shortSha: 'a1', upstream: null, upstreamTrack: null, isHead: false },
          { name: 'agent/issue-2', shortSha: 'b1', upstream: null, upstreamTrack: null, isHead: false },
          { name: 'agent/issue-10', shortSha: 'b2', upstream: null, upstreamTrack: null, isHead: true },
          { name: 'agent/deep/x', shortSha: 'b3', upstream: null, upstreamTrack: null, isHead: false },
          { name: 'cursor/y', shortSha: 'c1', upstream: null, upstreamTrack: null, isHead: false },
        ],
      }),
      CLEAN,
    );
    const branches = section(tree, 'section:branches').children;
    assert.deepEqual(labels(branches), ['agent', 'cursor', 'main']);

    const agent = branches[0];
    assert.equal(agent.kind, 'folder');
    assert.deepEqual(labels(agent.children), ['deep', 'issue-2', 'issue-10']);
    assert.deepEqual(labels(agent.children[0].children), ['x']);

    const head = agent.children[2];
    assert.equal(head.ref, 'agent/issue-10');
    assert.equal(head.contextValue, SIDEBAR_CONTEXT.headBranch);
    assert.equal(branches[2].contextValue, SIDEBAR_CONTEXT.localBranch);
  });

  it('marks branches with an upstream in their context values', () => {
    const tree = buildSidebarTree(
      snapshot({
        branches: [
          { name: 'main', shortSha: 'a1', upstream: 'origin/main', upstreamTrack: null, isHead: true },
          { name: 'feature', shortSha: 'b1', upstream: null, upstreamTrack: null, isHead: false },
          { name: 'tracked', shortSha: 'c1', upstream: 'origin/tracked', upstreamTrack: null, isHead: false },
        ],
      }),
      CLEAN,
    );
    const branches = section(tree, 'section:branches').children;
    assert.equal(branches.find((branch) => branch.ref === 'main')?.contextValue, SIDEBAR_CONTEXT.trackedHeadBranch);
    assert.equal(branches.find((branch) => branch.ref === 'feature')?.contextValue, SIDEBAR_CONTEXT.localBranch);
    assert.equal(branches.find((branch) => branch.ref === 'tracked')?.contextValue, SIDEBAR_CONTEXT.trackedLocalBranch);
  });

  it('describes ahead/behind and lists upstream in the tooltip', () => {
    const tree = buildSidebarTree(
      snapshot({
        branches: [
          {
            name: 'main',
            shortSha: 'abc1234',
            upstream: 'origin/main',
            upstreamTrack: '[ahead 1, behind 5]',
            isHead: true,
          },
        ],
      }),
      CLEAN,
    );
    const main = section(tree, 'section:branches').children[0];
    assert.equal(main.description, '5↓ 1↑');
    assert.equal(main.tooltip, 'main · abc1234\nUpstream: origin/main [ahead 1, behind 5]');
  });

  it('groups remote branches under their remote and hides remote HEAD refs', () => {
    const tree = buildSidebarTree(
      snapshot({
        remotes: [
          { name: 'origin', urls: ['git@github.com:o/r.git'] },
          { name: 'upstream', urls: [] },
        ],
        remoteBranches: [
          { name: 'origin', shortSha: 'h0', remote: 'origin' },
          { name: 'origin/HEAD', shortSha: 'h1', remote: 'origin' },
          { name: 'origin/main', shortSha: 'm1', remote: 'origin' },
          { name: 'origin/agent/issue-1', shortSha: 'i1', remote: 'origin' },
          { name: 'contrib/feature', shortSha: 'f1', remote: 'contrib' },
        ],
      }),
      CLEAN,
    );
    const remotes = section(tree, 'section:remotes').children;
    assert.deepEqual(labels(remotes), ['contrib', 'origin', 'upstream']);

    const origin = remotes[1];
    assert.equal(origin.description, 'git@github.com:o/r.git');
    assert.deepEqual(labels(origin.children), ['agent', 'main']);
    assert.equal(origin.children[1].ref, 'origin/main');
    assert.equal(origin.children[1].contextValue, SIDEBAR_CONTEXT.remoteBranch);
    assert.equal(origin.children[0].children[0].ref, 'origin/agent/issue-1');

    assert.deepEqual(remotes[2].children, []);
    assert.equal(treeItemSpec(remotes[2]).collapsible, 'none');
  });

  it('keeps tags in snapshot order', () => {
    const tree = buildSidebarTree(
      snapshot({
        tags: [
          { name: 'v2.0.0', shortSha: 't2', kind: 'annotated' },
          { name: 'v1.0.0', shortSha: 't1', kind: 'lightweight' },
        ],
      }),
      CLEAN,
    );
    const tags = section(tree, 'section:tags').children;
    assert.deepEqual(labels(tags), ['v2.0.0', 'v1.0.0']);
    assert.equal(tags[0].tooltip, 'v2.0.0 · t2 (annotated)');
  });

  it('gives every node a unique id that is stable across rebuilds', () => {
    const snap = snapshot({
      branches: [
        { name: 'origin-like/main', shortSha: 'a', upstream: null, upstreamTrack: null, isHead: false },
      ],
      remoteBranches: [{ name: 'origin/main', shortSha: 'b', remote: 'origin' }],
      remotes: [{ name: 'origin', urls: [] }],
      tags: [{ name: 'main', shortSha: 'c', kind: 'lightweight' }],
    });
    const ids = allNodes(buildSidebarTree(snap, CLEAN)).map((n) => n.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(allNodes(buildSidebarTree(snap, CLEAN)).map((n) => n.id), ids);
  });
});

describe('treeItemSpec', () => {
  const tree = buildSidebarTree(
    snapshot({
      branches: [
        { name: 'main', shortSha: 'a', upstream: null, upstreamTrack: null, isHead: true },
        { name: 'agent/x', shortSha: 'b', upstream: null, upstreamTrack: null, isHead: false },
      ],
      tags: [{ name: 'v1', shortSha: 'c', kind: 'lightweight' }],
    }),
    CLEAN,
  );
  const branches = section(tree, 'section:branches');

  it('maps clicks to the matching command with the node as argument', () => {
    assert.equal(treeItemSpec(tree[0]).command?.id, SIDEBAR_COMMANDS.showLocalChanges);
    assert.equal(treeItemSpec(tree[1]).command?.id, SIDEBAR_COMMANDS.showAllCommits);
    const main = branches.children[1];
    assert.deepEqual(treeItemSpec(main).command, { id: SIDEBAR_COMMANDS.revealInGraph, args: [main] });
    const tag = section(tree, 'section:tags').children[0];
    assert.equal(treeItemSpec(tag).command?.id, SIDEBAR_COMMANDS.revealInGraph);
  });

  it('does not attach a click command to sections and folders', () => {
    assert.equal(treeItemSpec(branches).command, undefined);
    assert.equal(treeItemSpec(branches.children[0]).command, undefined);
  });

  it('expands Branches, collapses other sections and folders', () => {
    assert.equal(treeItemSpec(branches).collapsible, 'expanded');
    assert.equal(treeItemSpec(section(tree, 'section:tags')).collapsible, 'collapsed');
    assert.equal(treeItemSpec(section(tree, 'section:stashes')).collapsible, 'collapsed');
    assert.equal(treeItemSpec(branches.children[0]).collapsible, 'collapsed');
    assert.equal(treeItemSpec(branches.children[1]).collapsible, 'none');
  });

  it('marks the HEAD branch with a check icon', () => {
    assert.equal(treeItemSpec(branches.children[1]).icon, 'check');
    assert.equal(treeItemSpec(branches.children[0].children[0]).icon, 'git-branch');
  });
});

function node(kind: SidebarNode['kind'], ref?: string): SidebarNode {
  return { id: `${kind}:${ref}`, kind, label: ref ?? kind, contextValue: kind, ref, children: [] };
}

describe('stash sidebar nodes', () => {
  const sha = 'a'.repeat(40);
  const tree = buildSidebarTree(snapshot(), CLEAN, [
    { index: 0, selector: 'stash@{0}', sha, message: 'On main: wip' },
    { index: 1, selector: 'stash@{1}', sha: 'b'.repeat(40), message: '' },
  ]);

  it('lists stash entries under Stashes and reveals them in the graph', () => {
    const stashes = section(tree, 'section:stashes');
    assert.equal(stashes.description, '2');
    assert.equal(treeItemSpec(stashes).collapsible, 'expanded');
    assert.deepEqual(
      stashes.children.map((node) => node.label),
      ['stash@{0}', 'stash@{1}'],
    );
    const entry = stashes.children[0];
    assert.equal(entry.contextValue, SIDEBAR_CONTEXT.stash);
    assert.equal(entry.description, 'On main: wip');
    assert.equal(treeItemSpec(entry).command?.id, SIDEBAR_COMMANDS.revealInGraph);
    assert.equal(treeItemSpec(entry).icon, 'git-stash');
  });

  it('orders a multi-selection for deletion from the highest index', () => {
    const stashes = section(tree, 'section:stashes').children;
    assert.deepEqual(pickStashSelectors(stashes[0], stashes), ['stash@{1}', 'stash@{0}']);
    assert.deepEqual(pickStashSelectors(stashes[0], [stashes[0], node('branch', 'main')]), ['stash@{0}']);
  });
});

describe('worktree sidebar nodes', () => {
  const entries: GitWorktreeDto[] = [
    {
      path: '/repos/main',
      head: 'a'.repeat(40),
      branch: 'refs/heads/main',
      detached: false,
      bare: false,
      locked: false,
      prunable: false,
      current: true,
    },
    {
      path: '/repos/feature',
      head: 'b'.repeat(40),
      branch: 'refs/heads/feature',
      detached: false,
      bare: false,
      locked: false,
      prunable: false,
      current: false,
    },
  ];
  const tree = buildSidebarTree(
    snapshot({
      branches: [
        {
          name: 'main',
          shortSha: 'aaaaaaa',
          upstream: null,
          upstreamTrack: null,
          isHead: true,
        },
        {
          name: 'feature',
          shortSha: 'bbbbbbb',
          upstream: null,
          upstreamTrack: null,
          isHead: false,
        },
      ],
    }),
    CLEAN,
    [],
    entries,
  );

  it('lists worktrees with the path and opens them on click', () => {
    const sectionNode = section(tree, 'section:worktrees');
    assert.equal(sectionNode.description, '2');
    assert.equal(treeItemSpec(sectionNode).collapsible, 'expanded');
    assert.deepEqual(
      sectionNode.children.map((node) => [node.label, node.description, node.contextValue]),
      [
        ['main', '/repos/main', SIDEBAR_CONTEXT.worktreeCurrent],
        ['feature', '/repos/feature', SIDEBAR_CONTEXT.worktree],
      ],
    );
    const current = sectionNode.children[0];
    const other = sectionNode.children[1];
    assert.equal(treeItemSpec(current).icon, 'worktree');
    assert.equal(treeItemSpec(other).icon, 'worktree');
    assert.equal(treeItemSpec(other).command?.id, SIDEBAR_COMMANDS.openWorktree);
    assert.equal(other.ref, '/repos/feature');
  });

  it('marks a branch checked out in another worktree', () => {
    const feature = section(tree, 'section:branches').children.find((node) => node.ref === 'feature');
    assert.ok(feature);
    assert.equal(feature.checkedOutElsewhere, true);
    assert.equal(feature.description, 'checked out');
    assert.equal(treeItemSpec(feature).icon, 'folder-opened');
    assert.match(feature.tooltip ?? '', /Checked out in \/repos\/feature/);
    const head = section(tree, 'section:branches').children.find((node) => node.ref === 'main');
    assert.equal(head?.checkedOutElsewhere, false);
    assert.equal(treeItemSpec(head!).icon, 'check');
  });

  it('collapses the section when there are no worktrees', () => {
    const empty = section(buildSidebarTree(snapshot(), CLEAN), 'section:worktrees');
    assert.equal(empty.children[0].label, 'No worktrees');
    assert.equal(treeItemSpec(empty).collapsible, 'collapsed');
  });
});

describe('submodule sidebar nodes', () => {
  const sha = '0123456789abcdef0123456789abcdef01234567';
  const entries: GitSubmoduleDto[] = [
    {
      path: 'libs/mid',
      sha,
      describe: 'heads/main',
      status: 'ok',
      absolutePath: '/repos/main/libs/mid',
    },
    {
      path: 'libs/mid/vendor/lib',
      sha: 'a'.repeat(40),
      describe: null,
      status: 'modified',
      absolutePath: '/repos/main/libs/mid/vendor/lib',
    },
    {
      path: 'missing',
      sha,
      describe: null,
      status: 'uninitialized',
      absolutePath: '/repos/main/missing',
    },
  ];
  const tree = buildSidebarTree(snapshot(), CLEAN, [], [], entries);

  it('nests child submodules under their parent', () => {
    const sectionNode = section(tree, 'section:submodules');
    assert.equal(sectionNode.description, '3');
    assert.equal(treeItemSpec(sectionNode).collapsible, 'expanded');
    assert.deepEqual(
      sectionNode.children.map((node) => node.label),
      ['libs/mid', 'missing'],
    );
    const mid = sectionNode.children[0];
    assert.equal(mid.contextValue, SIDEBAR_CONTEXT.submodule);
    assert.equal(mid.ref, 'libs/mid');
    assert.equal(treeItemSpec(mid).command?.id, SIDEBAR_COMMANDS.openSubmodule);
    assert.equal(treeItemSpec(mid).icon, 'file-submodule');
    assert.equal(treeItemSpec(mid).collapsible, 'collapsed');
    assert.equal(mid.children[0]?.label, 'vendor/lib');
    assert.equal(treeItemSpec(mid.children[0]!).icon, 'file-submodule');
    assert.equal(mid.children[0]?.contextValue, SIDEBAR_CONTEXT.submoduleModified);
    assert.equal(mid.children[0]?.description, `+${'a'.repeat(7)}`);
    const missing = sectionNode.children[1];
    assert.equal(missing.contextValue, SIDEBAR_CONTEXT.submoduleUninitialized);
    assert.equal(missing.description, 'not initialized');
    assert.equal(treeItemSpec(missing).icon, 'warning');
  });

  it('updates every selected submodule and ignores a mixed selection', () => {
    const mid = section(tree, 'section:submodules').children[0];
    const nested = mid.children[0];
    const missing = section(tree, 'section:submodules').children[1];
    assert.deepEqual(pickSubmodulePaths(mid, [mid, nested, missing]), [
      'libs/mid',
      'libs/mid/vendor/lib',
      'missing',
    ]);
    assert.deepEqual(pickSubmodulePaths(mid, [mid, node('branch', 'main')]), ['libs/mid']);
  });

  it('collapses the section when there are no submodules', () => {
    const empty = section(buildSidebarTree(snapshot(), CLEAN), 'section:submodules');
    assert.equal(empty.children[0].label, 'No submodules');
    assert.equal(treeItemSpec(empty).collapsible, 'collapsed');
  });
});

describe('pickCompareBranches', () => {
  it('returns both refs when exactly two local branches are selected', () => {
    const a = node('branch', 'a');
    const b = node('branch', 'b');
    assert.deepEqual(pickCompareBranches(a, [a, b]), ['a', 'b']);
  });

  const invalid: [string, SidebarNode | undefined, SidebarNode[] | undefined][] = [
    ['single click without selection', node('branch', 'a'), undefined],
    ['three branches', undefined, [node('branch', 'a'), node('branch', 'b'), node('branch', 'c')]],
    ['branch and tag', undefined, [node('branch', 'a'), node('tag', 't')]],
    ['branch and remote branch', undefined, [node('branch', 'a'), node('remoteBranch', 'o/a')]],
  ];
  for (const [name, clicked, selected] of invalid) {
    it(`rejects ${name}`, () => {
      assert.equal(pickCompareBranches(clicked, selected), null);
    });
  }
});

describe('dropIntent', () => {
  it('accepts a local branch dropped on another local branch', () => {
    assert.deepEqual(dropIntent([node('branch', 'feature')], node('branch', 'main')), {
      source: 'feature',
      target: 'main',
    });
  });

  const invalid: [string, SidebarNode[], SidebarNode | undefined][] = [
    ['drop on itself', [node('branch', 'main')], node('branch', 'main')],
    ['no target', [node('branch', 'main')], undefined],
    ['multiple sources', [node('branch', 'a'), node('branch', 'b')], node('branch', 'main')],
    ['remote branch source', [node('remoteBranch', 'origin/a')], node('branch', 'main')],
    ['folder target', [node('branch', 'a')], node('folder', 'agent')],
    ['tag target', [node('branch', 'a')], node('tag', 'v1')],
  ];
  for (const [name, sources, target] of invalid) {
    it(`rejects ${name}`, () => {
      assert.equal(dropIntent(sources, target), null);
    });
  }
});

describe('withSidebarSearch', () => {
  const sha = 'a'.repeat(40);
  const source = [
    ...buildSidebarTree(
      snapshot({
        branches: [
          { name: 'main', shortSha: 'aaaaaaa', upstream: null, upstreamTrack: null, isHead: true },
          { name: 'agent/feature', shortSha: 'bbbbbbb', upstream: null, upstreamTrack: null, isHead: false },
        ],
        remotes: [{ name: 'origin', urls: ['git@github.com:o/r.git'] }],
        remoteBranches: [{ name: 'origin/feature', shortSha: 'ccccccc', remote: 'origin' }],
        tags: [{ name: 'v1.0.0', shortSha: 'ddddddd', kind: 'lightweight' }],
      }),
      { dirty: true, stagedCount: 0, unstagedCount: 1 },
      [{ index: 0, selector: 'stash@{0}', sha, message: 'wip feature' }],
      [
        {
          path: '/repos/feature',
          head: sha,
          branch: 'refs/heads/feature',
          detached: false,
          bare: false,
          locked: false,
          prunable: false,
          current: false,
        },
      ],
      [
        {
          path: 'libs/mid',
          sha,
          describe: null,
          status: 'ok',
          absolutePath: '/work/demo/libs/mid',
        },
        {
          path: 'libs/mid/vendor/lib',
          sha,
          describe: null,
          status: 'modified',
          absolutePath: '/work/demo/libs/mid/vendor/lib',
        },
      ],
    ),
  ];

  it('lists every section and no Search row without a query', () => {
    const tree = withSidebarSearch(source, '');
    assert.deepEqual(labels(tree), [
      'Changes',
      'History',
      'Branches',
      'Remotes',
      'Tags',
      'Stashes',
      'Worktrees',
      'Submodules',
    ]);
    assert.equal(section(source, 'section:tags').children.length, 1);
  });

  it('keeps matching items in their sections with the same actions', () => {
    const tree = withSidebarSearch(source, 'FEATURE');
    assert.deepEqual(
      labels(tree),
      ['Changes', 'History', 'Branches', 'Remotes', 'Stashes', 'Worktrees'],
    );

    const branches = section(tree, 'section:branches');
    assert.equal(treeItemSpec(branches).collapsible, 'expanded');
    assert.equal(branches.children[0].label, 'agent');
    assert.equal(treeItemSpec(branches.children[0]).collapsible, 'expanded');
    const feature = branches.children[0].children[0];
    assert.equal(feature.ref, 'agent/feature');
    assert.equal(feature.contextValue, SIDEBAR_CONTEXT.localBranch);
    assert.equal(treeItemSpec(feature).command?.id, SIDEBAR_COMMANDS.revealInGraph);

    const origin = section(tree, 'section:remotes').children[0];
    assert.equal(origin.ref, 'origin');
    assert.equal(origin.children[0].ref, 'origin/feature');
    assert.equal(section(tree, 'section:stashes').children[0].ref, 'stash@{0}');
    assert.equal(section(tree, 'section:worktrees').children[0].ref, '/repos/feature');
  });

  it('matches every word across a ref and opens a matching folder', () => {
    const tree = withSidebarSearch(source, 'origin feature');
    assert.equal(section(tree, 'section:remotes').children[0].children[0].ref, 'origin/feature');
    assert.equal(tree.some((node) => node.id === 'section:branches'), false);

    const folder = withSidebarSearch(source, 'agent');
    const agent = section(folder, 'section:branches').children[0];
    assert.equal(agent.kind, 'folder');
    assert.equal(agent.children[0].ref, 'agent/feature');

    const vendor = withSidebarSearch(source, 'vendor');
    const parent = section(vendor, 'section:submodules').children[0];
    assert.equal(parent.ref, 'libs/mid');
    assert.equal(parent.children[0].ref, 'libs/mid/vendor/lib');
    assert.equal(parent.children[0].contextValue, SIDEBAR_CONTEXT.submoduleModified);
  });

  it('reports no matches without dropping the anchors', () => {
    const tree = withSidebarSearch(source, 'zzzz');
    assert.deepEqual(labels(tree), ['Changes', 'History', 'No matches']);
    assert.equal(tree[2].kind, 'message');
  });
});
