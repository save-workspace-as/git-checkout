import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { detectContentKind, hasImageExtension } from './contentKind';

describe('detectContentKind', () => {
  it('detects PNG magic', () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const result = detectContentKind(png);
    assert.equal(result.kind, 'image');
    assert.equal(result.mimeType, 'image/png');
  });

  it('detects LFS pointer in text buffer', () => {
    const text = `version https://git-lfs.github.com/spec/v1
oid sha256:4d7a214614ab2935c943f9a15698f1323bddb093b995844a6503eaf3bbb788f2
size 1
`;
    const result = detectContentKind(Buffer.from(text));
    assert.equal(result.kind, 'lfs-pointer');
    assert.ok(result.lfs);
  });
});

describe('hasImageExtension', () => {
  const cases: [string, boolean][] = [
    ['logo.png', true],
    ['assets/icon@2x.PNG', true],
    ['photo.jpeg', true],
    ['photo.JPG', true],
    ['anim.gif', true],
    ['hero.webp', true],
    ['diagram.svg', false],
    ['notes.txt', false],
    ['png', false],
    ['archive.png.zip', false],
    ['', false],
  ];
  for (const [path, expected] of cases) {
    it(`${expected ? 'accepts' : 'rejects'} "${path}"`, () => {
      assert.equal(hasImageExtension(path), expected);
    });
  }
});
