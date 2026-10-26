import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { cloneGitArgs, cloneTarget, parseCloneArg, parseCloneProgress, repositoryNameFromUrl, validateClone } from './cloneRequest';

describe('repositoryNameFromUrl', () => {
  for (const [url, name] of [
    ['git@github.com:microsoft/vscode.git', 'vscode'],
    ['https://github.com/microsoft/vscode.git', 'vscode'],
    ['https://github.com/microsoft/vscode/', 'vscode'],
    ['ssh://git@host:2222/team/project', 'project'],
    ['/srv/git/local.git', 'local'],
    ['host:project.git', 'project'],
    ['https://example.com/', 'example.com'],
    ['..', ''],
  ]) {
    it(`names ${url}`, () => assert.equal(repositoryNameFromUrl(url), name));
  }
});

describe('validateClone', () => {
  const location = mkdtempSync(join(tmpdir(), 'clone-request-'));

  it('accepts a URL and an existing folder', () => {
    assert.deepEqual(validateClone({ url: 'https://example.com/a/b.git', location }), {});
  });

  it('requires a URL and an absolute location', () => {
    assert.ok(validateClone({ url: '', location }).url);
    assert.ok(validateClone({ url: 'https://example.com/a/b.git', location: '' }).location);
    assert.ok(validateClone({ url: 'https://example.com/a/b.git', location: 'relative/dir' }).location);
  });

  it('rejects an option as the URL', () => {
    assert.ok(validateClone({ url: '--upload-pack=x', location }).url);
  });

  it('accepts a location that does not exist yet', () => {
    assert.deepEqual(validateClone({ url: 'https://example.com/a/b.git', location: join(location, 'new', 'deep') }), {});
  });

  it('rejects a repository folder that already has files, and accepts an empty one', () => {
    const request = { url: 'https://example.com/a/taken.git', location };
    mkdirSync(join(location, 'taken'));
    assert.deepEqual(validateClone(request), {});
    writeFileSync(join(location, 'taken', 'file'), 'x');
    assert.ok(validateClone(request).location?.includes('already exists'));
  });

  it('rejects a location that is a file', () => {
    const file = join(location, 'a-file');
    writeFileSync(file, 'x');
    assert.ok(validateClone({ url: 'https://example.com/a/b.git', location: file }).location);
  });
});

describe('cloneGitArgs', () => {
  const location = mkdtempSync(join(tmpdir(), 'clone-args-'));

  it('ends options before the URL and clones into the named folder', () => {
    const request = { url: ' https://example.com/a/b.git ', location };
    assert.deepEqual(cloneGitArgs(request), [
      'clone', '--progress', '--', 'https://example.com/a/b.git', join(location, 'b'),
    ]);
    assert.equal(cloneTarget(request), join(location, 'b'));
  });

  it('throws for an invalid request', () => {
    assert.throws(() => cloneGitArgs({ url: '-x', location }));
  });
});

describe('parseCloneArg', () => {
  const location = mkdtempSync(join(tmpdir(), 'clone-arg-'));

  it('is absent without url or location', () => {
    assert.deepEqual(parseCloneArg(undefined), { status: 'absent' });
    assert.deepEqual(parseCloneArg({ other: 1 }), { status: 'absent' });
    assert.deepEqual(parseCloneArg([]), { status: 'absent' });
  });

  it('is invalid when a field is missing or wrong', () => {
    assert.equal(parseCloneArg({ location }).status, 'invalid');
    assert.equal(parseCloneArg({ url: 'https://example.com/a/b.git' }).status, 'invalid');
    assert.equal(parseCloneArg({ url: 'nope', location }).status, 'invalid');
  });

  it('trims a ready request', () => {
    assert.deepEqual(parseCloneArg({ url: ' https://example.com/a/b.git', location: ` ${location}` }), {
      status: 'ready', request: { url: 'https://example.com/a/b.git', location },
    });
  });
});

describe('parseCloneProgress', () => {
  it('maps receiving to the first 80 percent and resolving deltas to the rest', () => {
    assert.deepEqual(parseCloneProgress('Receiving objects:  50% (50/100), 1.00 MiB | 2.00 MiB/s\r'),
      { phase: 'receiving', percent: 40 });
    assert.deepEqual(parseCloneProgress('Receiving objects: 100% (100/100), done.\n'),
      { phase: 'receiving', percent: 80 });
    assert.deepEqual(parseCloneProgress('Resolving deltas:  50% (5/10)\r'),
      { phase: 'resolving', percent: 90 });
    assert.deepEqual(parseCloneProgress('Resolving deltas: 100% (10/10), done.\n'),
      { phase: 'resolving', percent: 100 });
  });

  it('takes the newest percentage when Git redraws several in one chunk', () => {
    assert.equal(parseCloneProgress('Receiving objects:  10% (1/10)\rReceiving objects:  30% (3/10)\r')?.percent, 24);
  });

  it('reads the line Git sends through a remote prefix', () => {
    assert.equal(parseCloneProgress('remote: Receiving objects:  25%')?.percent, 20);
  });

  it('ignores lines that carry no percentage', () => {
    assert.equal(parseCloneProgress("Cloning into 'repo'...\n"), undefined);
    assert.equal(parseCloneProgress('remote: Counting objects:  50% (5/10)\r'), undefined);
    assert.equal(parseCloneProgress(''), undefined);
  });
});
