import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { parseLfsPointer } from '../../shared/diff/lfsPointer';
import { buildGraphLogArgs, GRAPH_PAGE_SIZE } from '../../features/graph/commitGraphService';
import type { GitCli } from '../gitCli';
import { commitEmptyAt, initTempRepository } from './gitRepoHarness';
import { parseGitLog } from '../gitLogParser';
import {
  createAddAddConflict,
  createContentMergeConflict,
  createLfsPointerFixture,
  createModifyDeleteConflict,
  createRebaseConflict,
  createSubmoduleFixture,
  createWorktreeFixture,
  lfsPointerText,
  rebaseInProgress,
  tryInitReftableRepository,
} from './scenarioFixtures';

async function porcelain(cli: GitCli): Promise<string> {
  return (await cli.execRead(['status', '--porcelain=v1'])).stdout;
}

describe('scenario fixtures', () => {
  it('stops a merge on a content conflict', async () => {
    const fixture = createContentMergeConflict();
    try {
      const status = await porcelain(fixture.repo.cli);
      assert.match(status, /^UU conflict\.txt$/m);
    } finally {
      fixture.cleanup();
    }
  });

  it('stops a merge on a modify/delete conflict', async () => {
    const fixture = createModifyDeleteConflict();
    try {
      const status = await porcelain(fixture.repo.cli);
      assert.match(status, /^UD note\.txt$/m);
    } finally {
      fixture.cleanup();
    }
  });

  it('stops a merge on an add/add conflict', async () => {
    const fixture = createAddAddConflict();
    try {
      const status = await porcelain(fixture.repo.cli);
      assert.match(status, /^AA added\.txt$/m);
    } finally {
      fixture.cleanup();
    }
  });

  it('stops a rebase on a content conflict', async () => {
    const fixture = createRebaseConflict();
    try {
      assert.equal(rebaseInProgress(fixture.repo.repoRoot), true);
      const status = await porcelain(fixture.repo.cli);
      assert.match(status, /^UU conflict\.txt$/m);
    } finally {
      fixture.cleanup();
    }
  });

  it('adds a submodule pointer', async () => {
    const fixture = createSubmoduleFixture();
    try {
      assert.equal(existsSync(join(fixture.repo.repoRoot, '.gitmodules')), true);
      assert.equal(existsSync(join(fixture.repo.repoRoot, 'vendor', 'lib.txt')), true);
      const status = (await fixture.repo.cli.execRead(['submodule', 'status'])).stdout;
      assert.match(status, /vendor/);
    } finally {
      fixture.cleanup();
    }
  });

  it('adds a linked worktree', async () => {
    const fixture = createWorktreeFixture();
    try {
      const listed = (await fixture.repo.cli.execRead(['worktree', 'list', '--porcelain'])).stdout;
      assert.match(listed, /branch refs\/heads\/feature/);
      assert.equal(existsSync(join(fixture.extras[0], 'linked')), true);
    } finally {
      fixture.cleanup();
    }
  });

  it('commits an LFS pointer file', () => {
    const fixture = createLfsPointerFixture();
    try {
      const text = readFileSync(join(fixture.repo.repoRoot, 'hero.bin'), 'utf8');
      assert.equal(text, lfsPointerText());
      assert.ok(parseLfsPointer(text));
    } finally {
      fixture.cleanup();
    }
  });

  it('uses a reftable layout when git supports it', async () => {
    const repo = tryInitReftableRepository();
    if (!repo) {
      return;
    }
    try {
      assert.equal(existsSync(join(repo.repoRoot, '.git', 'reftable')), true);
      const format = (await repo.cli.execRead(['rev-parse', '--show-ref-format'])).stdout.trim();
      assert.equal(format, 'reftable');
    } finally {
      repo.cleanup();
    }
  });
});

describe('large history smoke', () => {
  it('pages git log instead of loading every commit', async () => {
    const repo = initTempRepository();
    const extra = 10;
    try {
      for (let i = 0; i < GRAPH_PAGE_SIZE + extra; i++) {
        commitEmptyAt(repo.repoRoot, `c${i}`, 1_700_000_000 + i);
      }
      const first = parseGitLog(
        (await repo.cli.execRead(buildGraphLogArgs('HEAD', 0))).stdout,
      );
      const second = parseGitLog(
        (await repo.cli.execRead(buildGraphLogArgs('HEAD', GRAPH_PAGE_SIZE))).stdout,
      );
      assert.equal(first.length, GRAPH_PAGE_SIZE);
      assert.equal(second.length, extra);
      assert.equal(first.some((commit) => commit.sha === second[0]?.sha), false);
    } finally {
      repo.cleanup();
    }
  });
});
