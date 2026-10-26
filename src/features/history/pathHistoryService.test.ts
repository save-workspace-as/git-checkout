import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { PathHistoryService } from './pathHistoryService';
import { mockCliRegistry, mockGitCli } from '../../core/testing/serviceTestUtils';

describe('PathHistoryService', () => {
  it('loads a page with the requested log args', async () => {
    const record = (sha: string, parents: string, subject: string, time: string) =>
      [sha, parents, subject, 'Ada', 'ada@example.com', time, ''].join('\0') + '\0';
    const recorder = mockGitCli({
      execRead: async () => ({
        stdout: record('aaa', '', 'subject', '10') + record('bbb', 'aaa', 'older', '9'),
      }),
    });
    const service = new PathHistoryService(mockCliRegistry('/repo', recorder.cli));
    const page = await service.loadPage('/repo', {
      scope: 'file',
      path: 'notes.txt',
      follow: true,
      includeMerges: false,
      skip: 0,
      limit: 2,
    });
    assert.equal(page.commits.length, 2);
    assert.equal(page.commits[0].sha, 'aaa');
    assert.equal(page.hasMore, true);
    assert.equal(page.advance, 2);
    assert.ok(recorder.reads[0].includes('--follow'));
    assert.ok(recorder.reads[0].includes('--no-merges'));
  });

  it('resets a file through the write queue', async () => {
    const recorder = mockGitCli({
      execRead: async () => ({ stdout: ' notes.txt | 1 +\n' }),
    });
    const service = new PathHistoryService(mockCliRegistry('/repo', recorder.cli));
    const stat = await service.diffStat('/repo', 'abc', 'notes.txt');
    assert.match(stat, /notes.txt/);
    await service.resetFile('/repo', 'abc', 'notes.txt');
    assert.deepEqual(recorder.writes[0], ['checkout', 'abc', '--', 'notes.txt']);
  });
});
