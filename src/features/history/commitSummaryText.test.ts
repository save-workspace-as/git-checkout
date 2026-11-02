import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { GraphCommitDto } from '../../shared/graph/graphProtocol';
import { commitSummaryText, compareSummaryText } from './commitSummaryText';

const commit = (sha: string, authorDate: number): GraphCommitDto => ({
  sha, parents: [], subject: 'feat: add it', author: 'Ada', authorEmail: 'ada@example.com', authorDate, refs: [],
});

describe('commit summary text', () => {
  it('names the subject, the author, the day and the short hash', () => {
    const now = new Date(2026, 9, 31, 12, 0);
    const date = Math.floor(new Date(2026, 9, 31, 9, 41).getTime() / 1000);
    assert.equal(commitSummaryText(commit('e93beabc8816a294', date), now), 'feat: add it — Ada, Today at 09:41 · e93beab');
  });

  it('names both ends of a comparison', () => {
    assert.equal(compareSummaryText(commit('1111111aaaa', 0), commit('2222222bbbb', 0)), 'Changes from 1111111 to 2222222');
  });
});
