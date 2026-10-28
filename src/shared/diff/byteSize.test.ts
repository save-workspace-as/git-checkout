import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { formatByteSize } from './byteSize';

describe('formatByteSize', () => {
  const cases: [number, string][] = [
    [0, '0 B'],
    [512, '512 B'],
    [1023, '1023 B'],
    [1024, '1 KB'],
    [1536, '1.5 KB'],
    [275_456, '269 KB'],
    [1024 * 1024, '1 MB'],
    [489_472 * 2, '956 KB'],
    [5 * 1024 * 1024 + 512 * 1024, '5.5 MB'],
    [3 * 1024 ** 3, '3 GB'],
  ];
  for (const [bytes, expected] of cases) {
    it(`formats ${bytes} bytes as ${expected}`, () => {
      assert.equal(formatByteSize(bytes), expected);
    });
  }
});
