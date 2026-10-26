import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { formatCommitDate } from './commitDate';

const seconds = (date: Date) => date.getTime() / 1000;
const NOW = new Date(2026, 9, 17, 18, 30);

describe('formatCommitDate', () => {
  const cases: [string, Date, string][] = [
    ['same day', new Date(2026, 9, 17, 14, 5), 'Today at 14:05'],
    ['previous day', new Date(2026, 9, 16, 23, 59), 'Yesterday at 23:59'],
    ['two days ago', new Date(2026, 9, 15, 9, 0), '15 Oct 2026 at 09:00'],
    ['earlier year', new Date(2025, 0, 3, 7, 8), '3 Jan 2025 at 07:08'],
  ];
  for (const [name, date, expected] of cases) {
    it(name, () => {
      assert.equal(formatCommitDate(seconds(date), NOW), expected);
    });
  }

  it('treats the last day of the previous month as yesterday', () => {
    assert.equal(
      formatCommitDate(seconds(new Date(2026, 8, 30, 12, 0)), new Date(2026, 9, 1, 8, 0)),
      'Yesterday at 12:00',
    );
  });
});
