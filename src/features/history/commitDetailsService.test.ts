import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { DEFAULT_COMMIT_DIFF_VIEW } from '../../shared/diff/commitDiffPresentation';
import { commitCompareDiffArgs, commitDetailsDiffArgs } from '../../shared/history/commitDetails';
import { CommitDetailsService, commitDiffLines } from './commitDetailsService';
import { GitCliError } from '../../core/gitCliError';
import { mockCliRegistry, mockGitCli } from '../../core/testing/serviceTestUtils';

describe('CommitDetailsService', () => {
  const repoRoot = '/repo';

  it('lists name-status records for the selected commit', async () => {
    const recorded = mockGitCli({
      execRead: async (args) => {
        assert.deepEqual(args, commitDetailsDiffArgs('abc'));
        return { stdout: 'M\0a.txt\0R100\0old.txt\0new.txt\0' };
      },
    });
    const service = new CommitDetailsService(mockCliRegistry(repoRoot, recorded.cli));
    const files = await service.listFiles(repoRoot, ' abc ');
    assert.deepEqual(files, [
      { status: 'M', path: 'a.txt' },
      { status: 'R100', path: 'new.txt', oldPath: 'old.txt' },
    ]);
  });

  it('lists and diffs the changes between two commits', async () => {
    const calls: string[][] = [];
    const recorded = mockGitCli({
      execRead: async (args) => {
        calls.push(args);
        return args.includes('-z')
          ? { stdout: 'M\0a.txt\0A\0b.txt\0' }
          : { stdout: 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-x\n+y\n' };
      },
    });
    const service = new CommitDetailsService(mockCliRegistry(repoRoot, recorded.cli));
    assert.deepEqual(await service.listFilesBetween(repoRoot, ' old ', ' new '), [
      { status: 'M', path: 'a.txt' },
      { status: 'A', path: 'b.txt' },
    ]);
    assert.deepEqual(calls[0], commitCompareDiffArgs('old', 'new'));
    const diff = await service.diffFileBetween(repoRoot, 'old', 'new', 'a.txt');
    assert.deepEqual(calls[1], ['diff', '--no-color', '-p', '-M', '-U3', 'old', 'new', '--', 'a.txt']);
    await service.diffFileBetween(repoRoot, 'old', 'new', 'a.txt', {
      ...DEFAULT_COMMIT_DIFF_VIEW, ignoreWhitespace: true, contextLines: 12,
    });
    assert.deepEqual(calls[2], ['diff', '--no-color', '-p', '-M', '-U12', '-w', 'old', 'new', '--', 'a.txt']);
    assert.deepEqual(diff.lines.map((line) => line.kind), ['hunk', 'del', 'add']);
  });

  it('returns the first parent and null when the commit is a root', async () => {
    const recorded = mockGitCli({
      execRead: async (args) => {
        if (args[2] === 'child^') {
          return { stdout: 'parent\n' };
        }
        throw new GitCliError('ExitCode', 'bad revision', repoRoot, '', 128);
      },
    });
    const service = new CommitDetailsService(mockCliRegistry(repoRoot, recorded.cli));
    assert.equal(await service.resolveParent(repoRoot, 'child'), 'parent');
    assert.equal(await service.resolveParent(repoRoot, 'root'), null);
  });

  it('reads the commit message body without the subject', async () => {
    const recorded = mockGitCli({
      execRead: async (args) => {
        assert.deepEqual(args, ['log', '-1', '--format=%b', 'abc']);
        return { stdout: 'Fixes #12\n\n' };
      },
    });
    const service = new CommitDetailsService(mockCliRegistry(repoRoot, recorded.cli));
    assert.equal(await service.readBody(repoRoot, 'abc'), 'Fixes #12');
  });

  it('reads the full message from an annotated tag target', async () => {
    const recorded = mockGitCli({
      execRead: async (args) => {
        assert.deepEqual(args, ['log', '-1', '--format=%B', 'refs/tags/v1^{}']);
        return { stdout: 'Release v1\n\nPublished release\n\n' };
      },
    });
    const service = new CommitDetailsService(mockCliRegistry(repoRoot, recorded.cli));
    assert.equal(await service.readMessage(repoRoot, 'refs/tags/v1'), 'Release v1\n\nPublished release');
  });

  it('reads the committer name, email, and date', async () => {
    const recorded = mockGitCli({
      execRead: async (args) => {
        assert.deepEqual(args, ['log', '-1', '--format=%cn%x1f%ce%x1f%ct', 'abc']);
        return { stdout: 'Ada\x1fada@example.com\x1f1700000000\n' };
      },
    });
    const service = new CommitDetailsService(mockCliRegistry(repoRoot, recorded.cli));
    assert.deepEqual(await service.readCommitter(repoRoot, 'abc'), {
      name: 'Ada',
      email: 'ada@example.com',
      date: 1700000000,
    });
  });

  it('keeps added and removed lines from a unified diff', () => {
    const diff = [
      'diff --git a/a.txt b/a.txt',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n');
    assert.deepEqual(commitDiffLines(diff), {
      binary: false,
      lines: [
        { kind: 'hunk', text: '@@ -1 +1 @@' },
        { kind: 'del', text: 'old', line: 1 },
        { kind: 'add', text: 'new', line: 1 },
      ],
    });
  });
});
