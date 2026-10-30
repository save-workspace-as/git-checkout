import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { GitCliError } from '../../core/gitCliError';
import { mockCliRegistry, mockGitCli } from '../../core/testing/serviceTestUtils';
import { BlameService } from './blameService';

const ADA = 'a'.repeat(40);

function porcelain(sha: string, summary: string, lines: { final: number; text: string }[]): string {
  return lines
    .map((line, index) => {
      const head = [`${sha} ${line.final} ${line.final}${index === 0 ? ` ${lines.length}` : ''}`];
      if (index === 0) {
        head.push(
          'author Ada',
          'author-mail <ada@example.com>',
          'author-time 1700000000',
          'author-tz +0000',
          'committer Ada',
          'committer-mail <ada@example.com>',
          'committer-time 1700000000',
          'committer-tz +0000',
          `summary ${summary}`,
          'filename notes.txt',
        );
      }
      head.push(`\t${line.text}`);
      return head.join('\n');
    })
    .join('\n');
}

describe('BlameService', () => {
  it('batches large files, continues a hunk across pages, and stops at EOF', async () => {
    const repoRoot = '/repo';
    const recorder = mockGitCli({
      execRead: async (args) => {
        const range = /-L(\d+),(\d+)/.exec(args.join(' '));
        const start = Number(range?.[1]);
        if (start > 4) {
          throw new GitCliError(
            'ExitCode',
            'blame failed',
            repoRoot,
            'fatal: file notes.txt has only 4 lines',
            128,
          );
        }
        const lines = [
          { final: 1, text: 'one' },
          { final: 2, text: 'two' },
          { final: 3, text: 'three' },
          { final: 4, text: 'four' },
        ].filter((line) => line.final >= start && line.final <= start + 1);
        return { stdout: porcelain(ADA, 'edit', lines) };
      },
    });
    const service = new BlameService(mockCliRegistry(repoRoot, recorder.cli), 2);

    const first = await service.loadLines(repoRoot, { path: 'notes.txt', revision: '', startLine: 1 });
    assert.equal(first.lines.length, 2);
    assert.equal(first.hasMore, true);
    assert.equal(first.lines[0]?.groupStart, true);
    assert.equal(first.lines[1]?.groupStart, false);
    assert.equal(recorder.reads.length, 1);

    const cached = await service.loadLines(repoRoot, { path: 'notes.txt', revision: '', startLine: 1 });
    assert.equal(cached.lines.length, 2);
    assert.equal(recorder.reads.length, 1);

    const next = await service.loadLines(repoRoot, { path: 'notes.txt', revision: '', startLine: 3 });
    assert.deepEqual(
      next.lines.map((line) => line.text),
      ['three', 'four'],
    );
    assert.equal(next.lines[0]?.groupStart, false);
    assert.equal(next.hasMore, true);

    const done = await service.loadLines(repoRoot, { path: 'notes.txt', revision: '', startLine: 5 });
    assert.deepEqual(done.lines, []);
    assert.equal(done.hasMore, false);

    service.invalidate('/other');
    await service.loadLines(repoRoot, { path: 'notes.txt', revision: '', startLine: 1 });
    const readsBefore = recorder.reads.length;
    service.invalidate(repoRoot);
    await service.loadLines(repoRoot, { path: 'notes.txt', revision: '', startLine: 1 });
    assert.equal(recorder.reads.length, readsBefore + 1);
  });
});
