import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/** What `decodePng` gives: 8-bit RGBA, row after row. */
export interface Rgba {
  width: number;
  height: number;
  data: Buffer;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Reads the PNGs that profile pictures come as: 8 bits per channel, not interlaced, gray, RGB, palette (with or without
 * alpha) or RGBA. Anything else, or a file that is damaged, gives undefined.
 */
export function decodePng(bytes: Uint8Array): Rgba | undefined {
  const file = Buffer.from(bytes);
  if (file.length < 33 || !file.subarray(0, 8).equals(SIGNATURE)) {
    return undefined;
  }
  let header: { width: number; height: number; type: number } | undefined;
  let palette = Buffer.alloc(0);
  let transparency = Buffer.alloc(0);
  const parts: Buffer[] = [];
  for (let at = 8; at + 12 <= file.length; ) {
    const length = file.readUInt32BE(at);
    const type = file.toString('ascii', at + 4, at + 8);
    const data = file.subarray(at + 8, at + 8 + length);
    if (data.length !== length) {
      return undefined;
    }
    if (type === 'IHDR') {
      if (length !== 13 || data[8] !== 8 || data[12] !== 0) {
        return undefined;
      }
      header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), type: data[9] };
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'tRNS') {
      transparency = data;
    } else if (type === 'IDAT') {
      parts.push(data);
    } else if (type === 'IEND') {
      break;
    }
    at += length + 12;
  }
  const channels = header && ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[header.type];
  if (!header || !channels || header.width < 1 || header.height < 1 || header.width * header.height > 4_000_000) {
    return undefined;
  }
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(parts));
  } catch {
    // A damaged picture is left square rather than breaking the hover.
    return undefined;
  }
  const { width, height, type } = header;
  const stride = width * channels;
  if (raw.length !== (stride + 1) * height) {
    return undefined;
  }
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x];
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      const predicted = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter];
      if (predicted === undefined) {
        return undefined;
      }
      pixels[y * stride + x] = (value + predicted) & 0xff;
    }
  }
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const at = i * channels;
    let rgba: number[];
    if (type === 6) {
      rgba = [pixels[at], pixels[at + 1], pixels[at + 2], pixels[at + 3]];
    } else if (type === 2) {
      rgba = [pixels[at], pixels[at + 1], pixels[at + 2], 255];
    } else if (type === 0) {
      rgba = [pixels[at], pixels[at], pixels[at], 255];
    } else if (type === 4) {
      rgba = [pixels[at], pixels[at], pixels[at], pixels[at + 1]];
    } else {
      const entry = pixels[at];
      if (entry * 3 + 2 >= palette.length) {
        return undefined;
      }
      rgba = [palette[entry * 3], palette[entry * 3 + 1], palette[entry * 3 + 2], entry < transparency.length ? transparency[entry] : 255];
    }
    data.set(rgba, i * 4);
  }
  return { width, height, data };
}

export function encodePng({ width, height, data }: Rgba): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    data.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * The picture cut to a circle, with a soft edge one pixel wide, as a PNG. Undefined when the picture is not one
 * `decodePng` reads.
 */
export function roundPng(bytes: Uint8Array): Buffer | undefined {
  const picture = decodePng(bytes);
  if (!picture) {
    return undefined;
  }
  const { width, height, data } = picture;
  const radius = Math.min(width, height) / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const distance = Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2);
      const cover = Math.min(1, Math.max(0, radius - distance + 0.5));
      const alpha = y * width * 4 + x * 4 + 3;
      data[alpha] = Math.round(data[alpha] * cover);
    }
  }
  return encodePng(picture);
}
