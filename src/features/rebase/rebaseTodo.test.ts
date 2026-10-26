import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildPickLines, parseRebaseTodo, serializeRebaseTodo } from './rebaseTodo';

describe('rebaseTodo', () => {
  it('round-trips commit lines', () => {
    const text = `pick aaaa1111 First commit
squash bbbb2222 Second commit
fixup cccc3333 fixup! Second commit
# comment
drop dddd4444 Drop me
`;
    const parsed = parseRebaseTodo(text);
    assert.equal(parsed.length, 5);
    const serialized = serializeRebaseTodo(parsed);
    assert.equal(serialized, text);
  });

  it('buildPickLines creates picks', () => {
    const lines = buildPickLines([
      { hash: 'abc', subject: 'one' },
      { hash: 'def', subject: 'two' },
    ]);
    assert.equal(lines.length, 2);
    assert.equal(lines[0].command, 'pick');
    assert.equal(lines[1].hash, 'def');
  });
});
