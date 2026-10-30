import { strict as assert } from 'node:assert';
import { deflateSync } from 'node:zlib';
import { describe, it } from 'node:test';

import { decodePng, encodePng, roundPng, type Rgba } from './roundPng';

const solid = (size: number, rgba: [number, number, number, number]): Rgba => ({
  width: size,
  height: size,
  data: Buffer.from(Array.from({ length: size * size }, () => rgba).flat()),
});
const alphaAt = (picture: Rgba, x: number, y: number): number => picture.data[(y * picture.width + x) * 4 + 3];

describe('PNG round trip', () => {
  it('reads back what it wrote', () => {
    const picture = solid(5, [10, 20, 30, 200]);
    assert.deepEqual(decodePng(encodePng(picture)), picture);
  });

  it('reads the filters a picture can use', () => {
    // Two rows of three RGB pixels: a Sub row, then a Paeth row that adds nothing to the row above.
    const first = [10, 20, 30, 5, 5, 5, 5, 5, 5];
    const raw = Buffer.from([1, ...first, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const header = Buffer.alloc(13);
    header.writeUInt32BE(3, 0);
    header.writeUInt32BE(2, 4);
    header[8] = 8;
    header[9] = 2;
    const encoded = encodePng({ width: 1, height: 1, data: Buffer.alloc(4) });
    // Reuse the chunk layout of encodePng: swap in this header and data by rebuilding the file around them.
    const parts = (type: string, data: Buffer): Buffer => {
      const out = Buffer.alloc(data.length + 12);
      out.writeUInt32BE(data.length, 0);
      out.write(type, 4, 'ascii');
      data.copy(out, 8);
      return out;
    };
    const file = Buffer.concat([encoded.subarray(0, 8), parts('IHDR', header), parts('IDAT', deflateSync(raw)), parts('IEND', Buffer.alloc(0))]);
    const picture = decodePng(file);
    assert.deepEqual([...picture!.data.subarray(0, 12)], [10, 20, 30, 255, 15, 25, 35, 255, 20, 30, 40, 255]);
    assert.deepEqual([...picture!.data.subarray(12, 24)], [10, 20, 30, 255, 15, 25, 35, 255, 20, 30, 40, 255], 'the second row repeats the first');
  });

  it('gives nothing for what is not a readable PNG', () => {
    assert.equal(decodePng(new Uint8Array()), undefined);
    assert.equal(decodePng(new Uint8Array(64)), undefined);
    const png = encodePng(solid(3, [1, 2, 3, 4]));
    assert.equal(decodePng(png.subarray(0, png.length - 20)), undefined, 'cut short');
    const interlaced = Buffer.from(png);
    interlaced[8 + 8 + 12] = 1;
    assert.equal(decodePng(interlaced), undefined, 'interlaced');
  });
});

describe('roundPng', () => {
  it('clears the corners, keeps the middle and softens the edge', () => {
    const size = 32;
    const rounded = decodePng(roundPng(encodePng(solid(size, [200, 100, 50, 255])))!)!;
    assert.equal(alphaAt(rounded, 0, 0), 0);
    assert.equal(alphaAt(rounded, size - 1, 0), 0);
    assert.equal(alphaAt(rounded, 0, size - 1), 0);
    assert.equal(alphaAt(rounded, size - 1, size - 1), 0);
    assert.equal(alphaAt(rounded, size / 2, size / 2), 255);
    assert.deepEqual([...rounded.data.subarray((16 * size + 16) * 4, (16 * size + 16) * 4 + 3)], [200, 100, 50], 'the color is kept');
    const edge = alphaAt(rounded, 16, 0);
    assert.ok(edge > 0 && edge < 255, `the edge is soft, not ${edge}`);
  });

  it('keeps a picture that was see-through see-through', () => {
    const rounded = decodePng(roundPng(encodePng(solid(8, [1, 2, 3, 100])))!)!;
    assert.equal(alphaAt(rounded, 4, 4), 100);
  });

  it('is undefined for what is not a PNG', () => {
    assert.equal(roundPng(new Uint8Array([1, 2, 3])), undefined);
  });
});
