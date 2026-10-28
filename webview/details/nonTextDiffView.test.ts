import { strict as assert } from 'node:assert';
import { before, describe, it } from 'node:test';
import { sliceBinaryForPostMessage } from '../../src/shared/diff/binaryPayload';
import { DEFAULT_WORKING_COPY_DIFF_VIEW_OPTIONS } from '../../src/shared/diff/diffViewOptions';
import type { WorkingCopyBinaryBlobDto, WorkingCopyFileDiffDto } from '../protocol';
import { installDom } from '../testing/dom';

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

// lit reads `document` when it is imported, so it is imported once the DOM exists.
let render: typeof import('lit').render;
let applyBinaryChunk: typeof import('./nonTextDiffView').applyBinaryChunk;
let imageMetaText: typeof import('./nonTextDiffView').imageMetaText;
let nonTextDiffTemplate: typeof import('./nonTextDiffView').nonTextDiffTemplate;

before(async () => {
  installDom();
  URL.createObjectURL = () => 'blob:test';
  ({ render } = await import('lit'));
  ({ applyBinaryChunk, imageMetaText, nonTextDiffTemplate } = await import('./nonTextDiffView'));
});

function blob(side: 'old' | 'new', byteLength: number, bytes?: Uint8Array): WorkingCopyBinaryBlobDto {
  return {
    side,
    mimeType: 'image/png',
    byteLength,
    blobRef: `commit\0rev-${side}-${byteLength}\0logo.png\0${side}`,
    inline: bytes ? sliceBinaryForPostMessage(bytes) : undefined,
  };
}

function imageDiff(blobs: WorkingCopyBinaryBlobDto[]): WorkingCopyFileDiffDto {
  return {
    path: 'logo.png',
    side: 'staged',
    binary: true,
    nonTextKind: 'image',
    imageMode: 'sideBySide',
    blobs,
    hunks: [],
  };
}

function draw(diff: WorkingCopyFileDiffDto): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  render(nonTextDiffTemplate(diff, { ...DEFAULT_WORKING_COPY_DIFF_VIEW_OPTIONS, imageMode: 'sideBySide' }, () => {}), host);
  return host;
}

describe('image diff', () => {
  it('labels the sides Old and New, each with a framed picture and its file size', () => {
    const host = draw(imageDiff([blob('old', 275_456, png), blob('new', 489_472, png)]));
    const labels = [...host.querySelectorAll('.wd-image-label')].map((label) => label.textContent?.trim());
    assert.deepEqual(labels, ['Old', 'New']);
    assert.ok(host.querySelector('.wd-image-label--old'));
    assert.ok(host.querySelector('.wd-image-label--new'));
    assert.equal(host.querySelectorAll('.wd-image-frame img').length, 2);
    assert.deepEqual([...host.querySelectorAll('.wd-image-meta')].map((meta) => meta.textContent), ['269 KB', '478 KB']);
  });

  it('shows the pixel size once a picture has loaded', () => {
    const host = draw(imageDiff([blob('old', 2048, png), blob('new', 2048, png)]));
    const image = host.querySelector('.wd-image-cell img') as HTMLImageElement;
    Object.defineProperty(image, 'naturalWidth', { value: 1024 });
    Object.defineProperty(image, 'naturalHeight', { value: 1024 });
    image.dispatchEvent(new Event('load'));
    assert.equal(host.querySelector('.wd-image-meta')?.textContent, 'W: 1024px | H: 1024px (2 KB)');
  });

  it('says there is no image on a side that does not exist, as for an added file', () => {
    const host = draw(imageDiff([blob('old', 0), blob('new', 2048, png)]));
    assert.equal(host.querySelectorAll('.wd-image-frame').length, 1);
    assert.equal(host.querySelector('.wd-image-cell .wd-image-meta')?.textContent, 'No image');
  });
});

describe('imageMetaText', () => {
  it('gives only the file size before the dimensions are known', () => {
    assert.equal(imageMetaText(512), '512 B');
    assert.equal(imageMetaText(512, 0, 0), '512 B');
  });

  it('gives width, height and file size once they are known', () => {
    assert.equal(imageMetaText(1536, 64, 32), 'W: 64px | H: 32px (1.5 KB)');
  });
});

describe('applyBinaryChunk', () => {
  const bytes = Uint8Array.from({ length: 10 }, (_, index) => index + 1);

  /** The size of the Blob a diff draws for `blobRef` from whatever the cache holds. */
  function drawnSize(blobRef: string): number | undefined {
    const sizes: number[] = [];
    const create = URL.createObjectURL;
    URL.createObjectURL = (blob: Blob | MediaSource) => {
      sizes.push((blob as Blob).size);
      return 'blob:size';
    };
    try {
      draw(imageDiff([{ side: 'new', mimeType: 'image/png', byteLength: bytes.length, blobRef }]));
    } finally {
      URL.createObjectURL = create;
    }
    return sizes[0];
  }

  it('stores the first slice of a file it has not seen before', () => {
    applyBinaryChunk('whole', sliceBinaryForPostMessage(bytes));
    assert.equal(drawnSize('whole'), 10);
  });

  it('fills a file in as its slices arrive', () => {
    applyBinaryChunk('parts', sliceBinaryForPostMessage(bytes, 0, 4));
    applyBinaryChunk('parts', sliceBinaryForPostMessage(bytes, 4, 6));
    assert.equal(drawnSize('parts'), 10);
  });

  it('starts the buffer over when the file turns out to have another size', () => {
    applyBinaryChunk('resized', sliceBinaryForPostMessage(bytes));
    applyBinaryChunk('resized', sliceBinaryForPostMessage(Uint8Array.from({ length: 12 }, (_, index) => index)));
    assert.equal(drawnSize('resized'), 12);
  });
});
