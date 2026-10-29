import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { graphSearchGitArgs, parseGraphSearchQuery } from './searchQuery';

describe('parseGraphSearchQuery', () => {
  it('leaves a plain search alone', () => {
    assert.deepEqual(parseGraphSearchQuery('fix login'), { text: 'fix login' });
    assert.deepEqual(parseGraphSearchQuery(''), { text: '' });
  });

  it('reads each filter and keeps the words around them', () => {
    assert.deepEqual(
      parseGraphSearchQuery('fix author:ada path:src/app.ts since:2024-01-01 until:2024-06-30 content:retry login'),
      { text: 'fix login', author: 'ada', path: 'src/app.ts', since: '2024-01-01', until: '2024-06-30', content: 'retry' },
    );
  });

  it('takes a quoted value with spaces', () => {
    assert.deepEqual(parseGraphSearchQuery('author:"Ada Lovelace" parser'), { text: 'parser', author: 'Ada Lovelace' });
  });

  it('keeps an unknown key and an empty value as text', () => {
    assert.equal(parseGraphSearchQuery('fix: crash').text, 'fix: crash');
    assert.equal(parseGraphSearchQuery('scope:ui author:').text, 'scope:ui author:');
  });

  it('is not case sensitive about the key', () => {
    assert.equal(parseGraphSearchQuery('Author:ada').author, 'ada');
  });
});

describe('graphSearchGitArgs', () => {
  it('builds git log arguments from the filters, or nothing without any', () => {
    assert.equal(graphSearchGitArgs({ text: 'fix' }), undefined);
    assert.deepEqual(graphSearchGitArgs({ text: '', author: 'ada', since: '2024-01-01', content: 'x', path: 'a.ts' }), {
      args: ['--author=ada', '--since=2024-01-01', '-Sx'],
      path: 'a.ts',
    });
    assert.deepEqual(graphSearchGitArgs({ text: '', path: 'a.ts' }), { args: [], path: 'a.ts' });
    assert.deepEqual(graphSearchGitArgs({ text: '', regex: 'ne+dle' }), { args: ['-Gne+dle'] });
  });

  it('uses the pattern alone when a search has both a pattern and exact text', () => {
    assert.deepEqual(graphSearchGitArgs({ text: '', content: 'needle', regex: 'ne+dle' }), { args: ['-Gne+dle'] });
  });
});
