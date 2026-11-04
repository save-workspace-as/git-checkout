import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { buildConflictPrompt, buildWholeFilePrompt, fitsConflictPrompt, isBinaryText, isDeleteAnswer, MAX_CONFLICT_CHARS, parseResolvedFile } from './conflictPrompt';

const sides = { current: { label: 'main', subject: 'main edit' }, incoming: { label: 'topic', subject: '' } };

describe('buildConflictPrompt', () => {
  it('names the file and both sides, and carries the file with its markers', () => {
    const text = 'a\n<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> topic\n';
    const prompt = buildConflictPrompt({ path: 'src/a.ts', text, ...sides });
    assert.match(prompt, /File: src\/a\.ts/);
    assert.match(prompt, /Current side \(HEAD\): main "main edit"/);
    assert.match(prompt, /Incoming side: topic\n/);
    assert.ok(prompt.includes(`\`\`\`\n${text}\`\`\``), 'the file, without a blank line before the closing fence');
    assert.doesNotMatch(prompt, /Common ancestor/);
  });

  it('adds the common ancestor when there is one, and says unknown for a side with no name', () => {
    const prompt = buildConflictPrompt({
      path: 'a', text: 't', base: 'ancestor text', current: { label: '', subject: '' }, incoming: sides.incoming,
    });
    assert.match(prompt, /Common ancestor of the two sides:\n```\nancestor text\n```/);
    assert.match(prompt, /Current side \(HEAD\): unknown/);
  });
});

describe('fitsConflictPrompt', () => {
  it('counts the ancestor with the file', () => {
    assert.equal(fitsConflictPrompt({ text: 'x'.repeat(MAX_CONFLICT_CHARS) }), true);
    assert.equal(fitsConflictPrompt({ text: 'x'.repeat(MAX_CONFLICT_CHARS), base: 'y' }), false);
  });
});

describe('parseResolvedFile', () => {
  const resolved = (reply: string, original = 'one\n') => {
    const parsed = parseResolvedFile(reply, original);
    assert.ok(parsed.ok, `expected a resolution, got ${JSON.stringify(parsed)}`);
    return parsed.text;
  };

  it('takes the fenced block, with or without a language and a lead-in', () => {
    assert.equal(resolved('```ts\nconst a = 1;\n```'), 'const a = 1;\n');
    assert.equal(resolved('Here you go:\n\n```\nx\n```\n'), 'x\n');
  });

  it('keeps fences inside the file when the outer fence is longer', () => {
    assert.equal(resolved('````md\n```js\nx\n```\n````'), '```js\nx\n```\n');
  });

  it('takes a reply with no fence as the file', () => {
    assert.equal(resolved('plain\ntext'), 'plain\ntext\n');
  });

  it('gives the file the line endings and final line break of the original', () => {
    assert.equal(resolved('```\na\nb\n```', 'x\r\ny\r\n'), 'a\r\nb\r\n');
    assert.equal(resolved('```\na\nb\n\n```', 'x\ny'), 'a\nb');
  });

  it('refuses an empty reply', () => {
    for (const reply of ['', '  \n', '```\n\n```']) {
      assert.deepEqual(parseResolvedFile(reply, 'x'), { ok: false, reason: 'empty' });
    }
  });

  it('refuses a file that still has conflict markers', () => {
    for (const reply of [
      '```\na\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> topic\n```',
      '```\n<<<<<<<\nb\n```',
      '```\nb\n>>>>>>> topic\n```',
    ]) {
      assert.deepEqual(parseResolvedFile(reply, 'x'), { ok: false, reason: 'markers' });
    }
  });

  it('accepts a file that has a line of equals signs, as Markdown headings do', () => {
    assert.equal(resolved('```\nTitle\n=======\n```'), 'Title\n=======\n');
  });
});

describe('buildWholeFilePrompt', () => {
  const input = { path: 'a.json', currentSide: sides.current, incomingSide: sides.incoming };

  it('asks for a merge of the two versions, with the ancestor, when both sides have the file', () => {
    const prompt = buildWholeFilePrompt({ ...input, base: 'b\n', current: 'c\n', incoming: 'i\n' });
    assert.match(prompt, /Merge the two versions/);
    assert.match(prompt, /Common ancestor:\n```\nb\n```/);
    assert.match(prompt, /Current side file:\n```\nc\n```/);
    assert.match(prompt, /Incoming side file:\n```\ni\n```/);
    assert.doesNotMatch(prompt, /DELETE/);
  });

  it('names the side that deleted the file, and offers DELETE', () => {
    const prompt = buildWholeFilePrompt({ ...input, current: 'c\n' });
    assert.match(prompt, /The incoming side deleted this file/);
    assert.match(prompt, /exactly DELETE/);
    assert.doesNotMatch(prompt, /Incoming side file:/);
    assert.match(buildWholeFilePrompt({ ...input, incoming: 'i' }), /The current side deleted this file/);
  });
});

describe('isDeleteAnswer and isBinaryText', () => {
  it('takes DELETE alone, with or without ticks or space, and nothing longer', () => {
    for (const reply of ['DELETE', ' DELETE\n', '`DELETE`']) assert.equal(isDeleteAnswer(reply), true);
    for (const reply of ['delete the file', 'DELETE it', '```\nDELETE\nmore\n```']) assert.equal(isDeleteAnswer(reply), false);
  });

  it('finds a NUL byte in any text', () => {
    assert.equal(isBinaryText('a', undefined, 'b\0c'), true);
    assert.equal(isBinaryText('a', undefined), false);
  });
});
