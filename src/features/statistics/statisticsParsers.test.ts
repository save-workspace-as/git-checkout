import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { parseContributors, parseObjectSizes } from './statisticsParsers';

describe('parseContributors', () => {
  it('reads the count, name and email of each contributor', () => {
    assert.deepEqual(parseContributors('   120\tAda Lovelace <ada@example.com>\n     3\tGrace <g@example.com>\n'), [
      { commits: 120, name: 'Ada Lovelace', email: 'ada@example.com' },
      { commits: 3, name: 'Grace', email: 'g@example.com' },
    ]);
  });

  it('copes with a missing email and with blank output', () => {
    assert.deepEqual(parseContributors('     1\tNo Mail\n'), [{ commits: 1, name: 'No Mail', email: '' }]);
    assert.deepEqual(parseContributors(''), []);
  });
});

describe('parseObjectSizes', () => {
  it('reads the loose and packed sizes', () => {
    const output = 'count: 3\nsize: 12.00 KiB\nin-pack: 100\npacks: 1\nsize-pack: 1.50 MiB\nprune-packable: 0\n';
    assert.deepEqual(parseObjectSizes(output), { loose: '12.00 KiB', packed: '1.50 MiB' });
    assert.deepEqual(parseObjectSizes(''), { loose: '0 bytes', packed: '0 bytes' });
  });
});
