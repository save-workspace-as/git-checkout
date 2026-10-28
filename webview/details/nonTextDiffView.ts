import * as l10n from '@vscode/l10n';
import { html, nothing, render, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { ref } from 'lit/directives/ref.js';
import type { BinaryBlobSlice } from '../../src/shared/diff/binaryPayload';
import { formatByteSize } from '../../src/shared/diff/byteSize';
import { formatLfsPointerLabel } from '../../src/shared/diff/lfsPointer';
import type {
  ImageDiffMode,
  WorkingCopyBinaryBlobDto,
  WorkingCopyFileDiffDto,
  WorkingCopyDiffViewOptions,
} from '../protocol';
import type { WebviewMessage } from '../protocol';

const blobCache = new Map<string, Uint8Array>();

/** Adds a slice of a file to the cached bytes of `blobRef`, which grow into place as slices arrive. */
export function applyBinaryChunk(blobRef: string, chunk: BinaryBlobSlice): void {
  let target = blobCache.get(blobRef);
  if (!target || target.length !== chunk.byteLength) {
    const resized = new Uint8Array(chunk.byteLength);
    if (target) {
      resized.set(target.subarray(0, Math.min(target.length, chunk.byteLength)));
    }
    target = resized;
    blobCache.set(blobRef, target);
  }
  target.set(base64ToBytes(chunk.dataBase64), chunk.offset);
}

export function renderNonTextDiff(
  container: HTMLElement,
  diff: WorkingCopyFileDiffDto,
  viewOptions: WorkingCopyDiffViewOptions,
  postMessage: (message: WebviewMessage) => void,
): void {
  // The code viewer draws into the same container with plain DOM calls, which a template cannot follow,
  // so each draw gets its own host element instead of reusing one the viewer may have removed.
  const host = document.createElement('div');
  host.className = 'wd-nontext-host';
  container.replaceChildren(host);
  render(nonTextDiffTemplate(diff, viewOptions, postMessage), host);
}

/** What a diff shows for a file that is not text: a submodule, an LFS pointer, an image or other bytes. */
export function nonTextDiffTemplate(
  diff: WorkingCopyFileDiffDto,
  viewOptions: WorkingCopyDiffViewOptions,
  postMessage: (message: WebviewMessage) => void,
): TemplateResult {
  if (diff.nonTextKind === 'submodule' && diff.submodule) {
    return submoduleTemplate(diff.submodule);
  }
  if (diff.nonTextKind === 'lfs') {
    return lfsTemplate(diff);
  }
  if (diff.nonTextKind === 'image') {
    return imageTemplate(diff, viewOptions.imageMode, postMessage);
  }
  if (diff.nonTextKind === 'binary' || diff.binary) {
    return binaryTemplate(diff);
  }
  return html`<p>${l10n.t('Binary file (hunk staging not available).')}</p>`;
}

function submoduleTemplate(submodule: NonNullable<WorkingCopyFileDiffDto['submodule']>): TemplateResult {
  return html`
    <div class="wd-nontext wd-submodule-diff">
      <p>${l10n.t('Submodule {0} → {1}', submodule.oldSha.slice(0, 7), submodule.newSha.slice(0, 7))}</p>
      ${submodule.commits.length === 0
        ? html`<p>${l10n.t('No commits between these SHAs in the local object database.')}</p>`
        : html`<ul class="wd-submodule-commits">${submodule.commits.map((commit) =>
          html`<li>${commit.sha.slice(0, 7)} ${commit.subject}</li>`)}</ul>`}
    </div>`;
}

function lfsTemplate(diff: WorkingCopyFileDiffDto): TemplateResult {
  return html`
    <div class="wd-nontext wd-lfs-diff">
      <p>${l10n.t('Git LFS pointer change')}</p>
      <dl class="wd-lfs-table">
        <dt>${l10n.t('Before')}</dt><dd>${formatLfsPointerLabel(diff.lfsComparison?.old)}</dd>
        <dt>${l10n.t('After')}</dt><dd>${formatLfsPointerLabel(diff.lfsComparison?.new)}</dd>
      </dl>
    </div>`;
}

function binaryTemplate(diff: WorkingCopyFileDiffDto): TemplateResult {
  const blobs = diff.blobs ?? [];
  return html`
    <div class="wd-nontext wd-binary-placeholder">
      ${blobs.map((blob) => html`<p>${l10n.t('{0}: {1}, {2} bytes',
        blob.side === 'old' ? l10n.t('Before') : l10n.t('After'), blob.mimeType ?? 'application/octet-stream', blob.byteLength)}</p>`)}
      ${blobs.length === 0 ? html`<p>${l10n.t('Binary file (preview not available).')}</p>` : nothing}
    </div>`;
}

function imageTemplate(
  diff: WorkingCopyFileDiffDto,
  mode: ImageDiffMode,
  postMessage: (message: WebviewMessage) => void,
): TemplateResult {
  const oldUrl = blobObjectUrl(diff.blobs?.find((blob) => blob.side === 'old'));
  const newUrl = blobObjectUrl(diff.blobs?.find((blob) => blob.side === 'new'));
  const lazy = lazyLoadButtons(diff.blobs ?? [], postMessage);
  if (!oldUrl && !newUrl) {
    return html`<div class="wd-nontext wd-image-diff"><p>${l10n.t('Could not load image bytes.')}</p>${lazy}</div>`;
  }
  const panel = mode === 'pixel' ? pixelDiffTemplate(oldUrl, newUrl)
    : mode === 'swipe' ? swipeTemplate(oldUrl, newUrl)
      : mode === 'onion' ? onionTemplate(oldUrl, newUrl)
        : sideBySideTemplate(oldUrl, newUrl, diff.blobs);
  return html`<div class="wd-nontext wd-image-diff">${panel}${lazy}</div>`;
}

const sideBySideTemplate = (
  oldUrl: string | null,
  newUrl: string | null,
  blobs: WorkingCopyBinaryBlobDto[] | undefined,
): TemplateResult => html`
  <div class="wd-image-side-by-side">
    ${imageCell(l10n.t('Old'), 'old', oldUrl, blobs?.find((blob) => blob.side === 'old')?.byteLength ?? 0)}
    ${imageCell(l10n.t('New'), 'new', newUrl, blobs?.find((blob) => blob.side === 'new')?.byteLength ?? 0)}
  </div>`;

const imageCell = (label: string, tone: 'old' | 'new', url: string | null, byteLength: number): TemplateResult => html`
  <figure class="wd-image-cell">
    <figcaption class="wd-image-label wd-image-label--${tone}">${label}</figcaption>
    ${url ? imageFrameTemplate(url, label, byteLength) : html`<p class="wd-image-meta">${l10n.t('No image')}</p>`}
  </figure>`;

/** "W: 1024px | H: 1024px (269 KB)"; just the size until the picture has loaded and its dimensions are known. */
export function imageMetaText(byteLength: number, width?: number, height?: number): string {
  return width && height
    ? l10n.t('W: {0}px | H: {1}px ({2})', width, height, formatByteSize(byteLength))
    : formatByteSize(byteLength);
}

/** A picture on a checkerboard, so transparency shows, with its pixel size and file size beneath. */
export function imageFrameTemplate(url: string, alt: string, byteLength: number): TemplateResult {
  return html`
    <div class="wd-image-frame">
      <img src=${url} alt=${alt} @load=${(event: Event) => {
        const image = event.target as HTMLImageElement;
        const meta = image.closest('.wd-image-cell, .commit-tree-image')?.querySelector('.wd-image-meta');
        if (meta) {
          meta.textContent = imageMetaText(byteLength, image.naturalWidth, image.naturalHeight);
        }
      }}>
    </div>
    <p class="wd-image-meta">${imageMetaText(byteLength)}</p>`;
}

/** The old image shows over the new one up to the slider, which clips it from the right. */
function swipeTemplate(oldUrl: string | null, newUrl: string | null): TemplateResult {
  return html`
    <div class="wd-image-swipe">
      <div class="wd-image-swipe-stack">
        <img src=${newUrl ?? nothing}>
        <img class="wd-image-before" src=${oldUrl ?? nothing} style=${styleMap({ clipPath: 'inset(0 50% 0 0)' })}>
      </div>
      <input type="range" min="0" max="100" value="50" class="wd-image-swipe-slider"
        @input=${(event: Event) => {
          const slider = event.target as HTMLInputElement;
          const before = slider.closest<HTMLElement>('.wd-image-swipe')?.querySelector<HTMLElement>('.wd-image-before');
          if (before) { before.style.clipPath = `inset(0 ${100 - Number(slider.value)}% 0 0)`; }
        }}>
    </div>`;
}

/** The old image fades in over the new one as the slider moves. */
function onionTemplate(oldUrl: string | null, newUrl: string | null): TemplateResult {
  return html`
    <div class="wd-image-onion">
      <img src=${newUrl ?? nothing}>
      <img class="wd-image-before" src=${oldUrl ?? nothing} style=${styleMap({ opacity: '1' })}>
      <input type="range" min="0" max="100" value="0"
        @input=${(event: Event) => {
          const slider = event.target as HTMLInputElement;
          const before = slider.closest<HTMLElement>('.wd-image-onion')?.querySelector<HTMLElement>('.wd-image-before');
          if (before) { before.style.opacity = String(Number(slider.value) / 100); }
        }}>
    </div>`;
}

function pixelDiffTemplate(oldUrl: string | null, newUrl: string | null): TemplateResult {
  if (!oldUrl || !newUrl) {
    return html`<div class="wd-image-pixel-diff"><p>${l10n.t('Pixel diff needs both sides.')}</p></div>`;
  }
  return html`<div class="wd-image-pixel-diff"><canvas ${ref((canvas) => {
    if (canvas) { loadPixelDiff(canvas as HTMLCanvasElement, oldUrl, newUrl); }
  })}></canvas></div>`;
}

function loadPixelDiff(canvas: HTMLCanvasElement, oldUrl: string, newUrl: string): void {
  const oldImg = new Image();
  const newImg = new Image();
  oldImg.onload = () => {
    newImg.onload = () => drawPixelDiff(canvas, oldImg, newImg);
    newImg.src = newUrl;
  };
  oldImg.src = oldUrl;
}

function drawPixelDiff(canvas: HTMLCanvasElement, oldImg: HTMLImageElement, newImg: HTMLImageElement): void {
  const width = Math.max(oldImg.naturalWidth, newImg.naturalWidth);
  const height = Math.max(oldImg.naturalHeight, newImg.naturalHeight);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  const oldCanvas = document.createElement('canvas');
  oldCanvas.width = width;
  oldCanvas.height = height;
  const newCanvas = document.createElement('canvas');
  newCanvas.width = width;
  newCanvas.height = height;
  const oldCtx = oldCanvas.getContext('2d');
  const newCtx = newCanvas.getContext('2d');
  if (!oldCtx || !newCtx) {
    return;
  }
  oldCtx.drawImage(oldImg, 0, 0);
  newCtx.drawImage(newImg, 0, 0);
  const oldData = oldCtx.getImageData(0, 0, width, height).data;
  const newData = newCtx.getImageData(0, 0, width, height).data;
  const out = ctx.createImageData(width, height);
  for (let i = 0; i < oldData.length; i += 4) {
    const dr = Math.abs(oldData[i] - newData[i]);
    const dg = Math.abs(oldData[i + 1] - newData[i + 1]);
    const db = Math.abs(oldData[i + 2] - newData[i + 2]);
    const changed = dr + dg + db > 24;
    out.data[i] = changed ? 255 : oldData[i];
    out.data[i + 1] = changed ? 40 : oldData[i + 1];
    out.data[i + 2] = changed ? 40 : oldData[i + 2];
    out.data[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
}

function blobObjectUrl(blob: WorkingCopyBinaryBlobDto | undefined): string | null {
  if (!blob) {
    return null;
  }
  let bytes = blobCache.get(blob.blobRef);
  if (!bytes && blob.inline) {
    applyBinaryChunk(blob.blobRef, blob.inline);
    bytes = blobCache.get(blob.blobRef);
  }
  if (!bytes || bytes.length === 0) {
    return null;
  }
  const mime = blob.mimeType ?? 'application/octet-stream';
  return URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: mime }));
}

function lazyLoadButtons(
  blobs: WorkingCopyBinaryBlobDto[],
  postMessage: (message: WebviewMessage) => void,
): TemplateResult {
  return html`${blobs.map((blob) => {
    const cached = blobCache.get(blob.blobRef);
    if ((cached && cached.length >= blob.byteLength) || !blob.inline?.truncated) {
      return nothing;
    }
    return html`<vscode-button type="button" secondary @click=${() => postMessage({
      type: 'workingCopyRequestBinaryChunk',
      blobRef: blob.blobRef,
      offset: cached?.length ?? blob.inline?.chunkByteLength ?? 0,
    })}>${l10n.t('Load full {0} preview ({1} bytes)', blob.side, blob.byteLength)}</vscode-button>`;
  })}`;
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
