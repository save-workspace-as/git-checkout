import { isLfsPointerText, parseLfsPointer, type LfsPointerFields } from './lfsPointer';

export type DetectedContentKind = 'text' | 'image' | 'lfs-pointer' | 'binary';

export interface ContentKindResult {
  kind: DetectedContentKind;
  mimeType?: string;
  lfs?: LfsPointerFields;
}

const IMAGE_MIME_BY_MAGIC: { mime: string; match: (buf: Uint8Array) => boolean }[] = [
  {
    mime: 'image/png',
    match: (buf) =>
      buf.length >= 8 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47,
  },
  {
    mime: 'image/jpeg',
    match: (buf) => buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  },
  {
    mime: 'image/gif',
    match: (buf) =>
      buf.length >= 6 &&
      buf[0] === 0x47 &&
      buf[1] === 0x49 &&
      buf[2] === 0x46 &&
      buf[3] === 0x38,
  },
  {
    mime: 'image/webp',
    match: (buf) =>
      buf.length >= 12 &&
      buf[0] === 0x52 &&
      buf[1] === 0x49 &&
      buf[2] === 0x46 &&
      buf[3] === 0x46 &&
      buf[8] === 0x57 &&
      buf[9] === 0x45 &&
      buf[10] === 0x42 &&
      buf[11] === 0x50,
  },
];

export function detectContentKind(bytes: Uint8Array): ContentKindResult {
  for (const entry of IMAGE_MIME_BY_MAGIC) {
    if (entry.match(bytes)) {
      return { kind: 'image', mimeType: entry.mime };
    }
  }

  const asText = decodeUtf8Sample(bytes);
  if (isLfsPointerText(asText)) {
    const lfs = parseLfsPointer(asText);
    if (lfs) {
      return { kind: 'lfs-pointer', lfs };
    }
  }

  if (looksLikeText(bytes)) {
    return { kind: 'text' };
  }

  return { kind: 'binary' };
}

function decodeUtf8Sample(bytes: Uint8Array): string {
  const sample = bytes.subarray(0, Math.min(bytes.length, 512));
  return Buffer.from(sample).toString('utf8');
}

function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) {
    return true;
  }
  let control = 0;
  const len = Math.min(bytes.length, 4096);
  for (let i = 0; i < len; i++) {
    const b = bytes[i];
    if (b === 0) {
      return false;
    }
    if (b < 9 || (b > 13 && b < 32)) {
      control++;
    }
  }
  return control / len < 0.05;
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

/** Whether the name suggests a picture of a kind `detectContentKind` recognizes by its bytes. */
export function hasImageExtension(filePath: string): boolean {
  const dot = filePath.lastIndexOf('.');
  return dot >= 0 && IMAGE_EXTENSIONS.has(filePath.slice(dot + 1).toLowerCase());
}
