import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import type { GraphRefDto } from '../shared/graph/graphProtocol';
import { parseGitLog, parseRefDecorations } from './gitLogParser';

describe('parseGitLog', () => {
  it('parses null-separated commit records', () => {
    const output = [
      'abc123',
      'parent1 parent2',
      'Fix parser',
      'Alice',
      'alice@example.com',
      '1700000000',
      'HEAD -> refs/heads/main',
    ].join('\0');

    const commits = parseGitLog(output);
    assert.equal(commits.length, 1);
    assert.deepEqual(commits[0], {
      sha: 'abc123',
      parents: ['parent1', 'parent2'],
      subject: 'Fix parser',
      author: 'Alice',
      authorEmail: 'alice@example.com',
      authorDate: 1700000000,
      refs: [{ kind: 'local', name: 'main', isHead: true }],
    });
  });

  it('parses consecutive records separated by newlines', () => {
    const output = `${['a', 'b', 's1', 'A', 'a@x', '2', ''].join('\0')}\0\n${['b', '', 's2', 'B', 'b@x', '1', ''].join('\0')}\0`;
    assert.deepEqual(
      parseGitLog(output).map((c) => [c.sha, c.parents]),
      [
        ['a', ['b']],
        ['b', []],
      ],
    );
  });

  it('handles commits with no parents', () => {
    const output = ['root', '', 'Initial', 'Bob', 'bob@x', '0', ''].join('\0');
    const commits = parseGitLog(output);
    assert.deepEqual(commits[0].parents, []);
    assert.equal(commits[0].authorDate, 0);
    assert.deepEqual(commits[0].refs, []);
  });

  it('skips incomplete trailing records', () => {
    assert.deepEqual(parseGitLog('onlysha\0'), []);
  });
});

describe('parseRefDecorations', () => {
  const cases: [string, GraphRefDto[]][] = [
    ['', []],
    ['HEAD -> refs/heads/main', [{ kind: 'local', name: 'main', isHead: true }]],
    [
      'HEAD -> refs/heads/agent/x, refs/remotes/origin/agent/x',
      [
        { kind: 'local', name: 'agent/x', isHead: true },
        { kind: 'remote', name: 'origin/agent/x' },
      ],
    ],
    ['HEAD, refs/heads/feature', [{ kind: 'head', name: 'HEAD' }, { kind: 'local', name: 'feature' }]],
    ['tag: refs/tags/v1.0.0', [{ kind: 'tag', name: 'v1.0.0' }]],
    ['refs/remotes/origin/HEAD, refs/remotes/origin/main', [{ kind: 'remote', name: 'origin/main' }]],
    ['refs/stash', [{ kind: 'stash', name: 'stash' }]],
    ['refs/notes/commits', []],
  ];
  for (const [input, expected] of cases) {
    it(`parses ${JSON.stringify(input)}`, () => {
      assert.deepEqual(parseRefDecorations(input), expected);
    });
  }
});
