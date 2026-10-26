import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const root = join(__dirname, '..');
const read = (path: string): string => readFileSync(join(root, path), 'utf8');

const ICONS = ['icon-color', 'icon-color-square', 'icon-mono', 'icon-mono-light', 'icon-mono-dark'];
const LOCKUPS = ['lockup-color', 'lockup-color-light', 'lockup-color-dark', 'lockup-mono', 'lockup-mono-light', 'lockup-mono-dark'];

describe('logo assets', () => {
  it('has a colored and a monochrome version, for light and dark, of the icon and of the lockup', () => {
    for (const name of [...ICONS, ...LOCKUPS]) {
      const svg = read(`resources/logo/${name}.svg`);
      assert.match(svg, /^<svg [^>]*viewBox=/, name);
      assert.match(svg, /aria-label="git-checkout"/, name);
    }
  });

  it('draws the colored logo in Git orange and the monochrome ones in a single color', () => {
    assert.match(read('resources/logo/icon-color.svg'), /#F05032/);
    assert.equal(read('resources/logo/icon-mono-light.svg').match(/#[0-9A-Fa-f]{6}/g)?.every((c) => c === '#212121'), true);
    assert.equal(read('resources/logo/icon-mono-dark.svg').match(/#[0-9A-Fa-f]{6}/g)?.every((c) => c === '#ECEFF1'), true);
    // The themed glyph takes its color from where it is used.
    assert.doesNotMatch(read('resources/logo/icon-mono.svg'), /#[0-9A-Fa-f]{6}/);
    assert.doesNotMatch(read('resources/git-checkout.svg'), /#[0-9A-Fa-f]{6}/);
  });

  it('uses the same mark for the activity bar and the modal header as the monochrome logo', () => {
    assert.equal(read('resources/git-checkout.svg'), read('resources/logo/icon-mono.svg'));
  });

  it('makes the colored lockup legible on dark backgrounds too', () => {
    const adaptive = read('resources/logo/lockup-color.svg');
    assert.match(adaptive, /prefers-color-scheme:dark/);
    assert.notEqual(read('resources/logo/lockup-color-light.svg'), read('resources/logo/lockup-color-dark.svg'));
  });

  it('gives the extension a square PNG icon of at least 128 pixels', () => {
    const manifest = JSON.parse(read('package.json')) as { icon?: string };
    assert.equal(manifest.icon, 'resources/icon.png');
    const png = readFileSync(join(root, manifest.icon));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)];
    assert.equal(width, height);
    assert.ok(width >= 128, `${width}px`);
  });

  it('ships the tab icons the panel uses', () => {
    for (const name of ['icon-mono-light', 'icon-mono-dark']) {
      assert.ok(existsSync(join(root, `resources/logo/${name}.svg`)), name);
    }
    assert.ok(!read('.vscodeignore').includes('resources/logo'), 'the logo folder must not be excluded from the package');
  });
});
