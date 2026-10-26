import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  loadRemoteUrls,
  parseLocalBranches,
  parseRemoteBranches,
  parseRemoteNames,
  parseRevListLeftRightCount,
  parseTags,
} from './gitRefParser';

describe('parseLocalBranches', () => {
  it('parses null-separated branch records and marks HEAD', () => {
    const output = [
      'main',
      'abc1234',
      'origin/main',
      '[ahead 1]',
      '*',
      'feature/x',
      'def5678',
      '',
      '',
      '',
    ].join('\0');

    const branches = parseLocalBranches(output, 'main');

    assert.equal(branches.length, 2);
    assert.deepEqual(branches[0], {
      name: 'main',
      shortSha: 'abc1234',
      upstream: 'origin/main',
      upstreamTrack: '[ahead 1]',
      isHead: true,
    });
    assert.equal(branches[1].name, 'feature/x');
    assert.equal(branches[1].isHead, false);
  });

  it('marks head by name when marker is absent', () => {
    const output = ['dev', 'sha1', '', '', '', 'other', 'sha2', '', '', ''].join('\0');
    const branches = parseLocalBranches(output, 'dev');
    assert.equal(branches[0].isHead, true);
    assert.equal(branches[1].isHead, false);
  });

  it('returns empty array for empty output', () => {
    assert.deepEqual(parseLocalBranches('', null), []);
  });

  it('parses newline-separated records from git for-each-ref', () => {
    const output = [
      'feature\0abc\0\0\0 ',
      'main\0def\0origin/main\0\0*',
    ].join('\n');
    const branches = parseLocalBranches(output, 'main');
    assert.equal(branches.length, 2);
    assert.equal(branches.find((b) => b.name === 'main')?.isHead, true);
    assert.equal(branches.find((b) => b.name === 'feature')?.isHead, false);
  });
});

describe('parseRemoteBranches', () => {
  it('splits remote prefix from branch name', () => {
    const output = ['origin/main', 'abc1234', 'origin/feature', 'def5678'].join('\0');
    const branches = parseRemoteBranches(output);
    assert.deepEqual(branches, [
      { name: 'origin/main', shortSha: 'abc1234', remote: 'origin' },
      { name: 'origin/feature', shortSha: 'def5678', remote: 'origin' },
    ]);
  });
});

describe('parseTags', () => {
  it('classifies annotated vs lightweight tags', () => {
    const output = ['v1.0\0aaa\0commit\0v2.0\0bbb\0tag'].join('\0');
    const tags = parseTags(output);
    assert.deepEqual(tags, [
      { name: 'v1.0', shortSha: 'aaa', kind: 'lightweight' },
      { name: 'v2.0', shortSha: 'bbb', kind: 'annotated' },
    ]);
  });
});

describe('parseRemoteNames', () => {
  it('trims lines and drops blanks', () => {
    assert.deepEqual(parseRemoteNames(' origin \n\nupstream\r\n'), ['origin', 'upstream']);
  });
});

describe('parseRevListLeftRightCount', () => {
  it('parses left/right counts', () => {
    assert.deepEqual(parseRevListLeftRightCount('3\t7\n'), { left: 3, right: 7 });
    assert.deepEqual(parseRevListLeftRightCount(''), { left: 0, right: 0 });
  });
});

describe('loadRemoteUrls', () => {
  it('collects urls per remote and tolerates failures', async () => {
    const cli = {
      execRead: async (args: string[]) => {
        const name = args[3];
        if (name === 'bad') {
          throw new Error('missing');
        }
        return { stdout: `https://example.com/${name}.git\n` };
      },
    };

    const remotes = await loadRemoteUrls(cli, ['origin', 'bad']);
    assert.deepEqual(remotes, [
      { name: 'origin', urls: ['https://example.com/origin.git'] },
      { name: 'bad', urls: [] },
    ]);
  });

  it('looks every remote up at once and keeps their order', async () => {
    const started: string[] = [];
    const releases = new Map<string, () => void>();
    const cli = {
      execRead: (args: string[]) => {
        const name = args[3];
        started.push(name);
        return new Promise<{ stdout: string }>((resolve) =>
          releases.set(name, () => resolve({ stdout: `https://example.com/${name}.git\n` })),
        );
      },
    };
    const pending = loadRemoteUrls(cli, ['b', 'a', 'c']);
    assert.deepEqual(started, ['b', 'a', 'c'], 'none waits for another to finish');
    // They finish in the reverse order; the result still follows the order asked for.
    for (const name of ['c', 'a', 'b']) {
      releases.get(name)?.();
    }
    assert.deepEqual((await pending).map((remote) => remote.name), ['b', 'a', 'c']);
  });
});
