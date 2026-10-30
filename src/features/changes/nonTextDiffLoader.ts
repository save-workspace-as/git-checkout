import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { GitCli } from '../../core/gitCli';
import type { ParsedDiffFile } from '../../core/gitDiffParser';
import { sliceBinaryForPostMessage, type BinaryBlobSlice } from '../../shared/diff/binaryPayload';
import { MAX_IMAGE_PREVIEW_BYTES } from '../../shared/diff/binaryDiffLimits';
import { detectContentKind, type DetectedContentKind } from '../../shared/diff/contentKind';
import { parseLfsPointer, type LfsPointerFields } from '../../shared/diff/lfsPointer';
import {
  parseSubmoduleLogOutput,
  parseSubmoduleShasFromDiffText,
  type SubmoduleCommitLine,
} from '../../shared/submodules/submoduleDiff';
import type { WorkingCopyDiffSide } from '../../shared/changes/workingCopyProtocol';
import { createLogger } from '../../log';

const log = createLogger('non-text-diff');

export type NonTextDiffKind = 'image' | 'binary' | 'lfs' | 'submodule';

export interface NonTextBlobSideDto {
  side: 'old' | 'new';
  mimeType?: string;
  byteLength: number;
  blobRef: string;
  inline?: BinaryBlobSlice;
  lfs?: LfsPointerFields;
}

export interface NonTextDiffSummary {
  kind: NonTextDiffKind;
  blobs: NonTextBlobSideDto[];
  lfsComparison?: {
    old?: LfsPointerFields;
    new?: LfsPointerFields;
  };
  submodule?: {
    oldSha: string;
    newSha: string;
    commits: SubmoduleCommitLine[];
  };
}

export function buildBlobRef(
  repoRoot: string,
  path: string,
  side: WorkingCopyDiffSide,
  blobSide: 'old' | 'new',
): string {
  return `${repoRoot}\0${path}\0${side}\0${blobSide}`;
}

export function parseBlobRef(blobRef: string): {
  repoRoot: string;
  path: string;
  diffSide: WorkingCopyDiffSide;
  blobSide: 'old' | 'new';
} | null {
  const parts = blobRef.split('\0');
  if (parts.length !== 4) {
    return null;
  }
  const [repoRoot, path, diffSide, blobSide] = parts;
  if (diffSide !== 'staged' && diffSide !== 'unstaged') {
    return null;
  }
  if (blobSide !== 'old' && blobSide !== 'new') {
    return null;
  }
  return { repoRoot, path, diffSide, blobSide };
}

export async function loadNonTextDiffSummary(
  cli: GitCli,
  repoRoot: string,
  relPath: string,
  wcSide: WorkingCopyDiffSide,
  parsedFile: ParsedDiffFile,
  rawDiffStdout: string,
): Promise<NonTextDiffSummary | null> {
  const submodulePair = parseSubmoduleShasFromDiffText(rawDiffStdout);
  if (submodulePair) {
    const commits = await listSubmoduleCommits(cli, relPath, submodulePair.oldSha, submodulePair.newSha);
    return {
      kind: 'submodule',
      blobs: [],
      submodule: {
        oldSha: submodulePair.oldSha,
        newSha: submodulePair.newSha,
        commits,
      },
    };
  }

  const shouldProbeBlobs =
    parsedFile.binary ||
    rawDiffStdout.includes('git-lfs.github.com/spec') ||
    /\.(png|jpe?g|gif|webp|ico|bmp)$/i.test(relPath);

  if (!shouldProbeBlobs && parsedFile.hunks.length > 0) {
    return null;
  }

  const oldBytes = await readBlobBytes(cli, repoRoot, relPath, wcSide, 'old');
  const newBytes = await readBlobBytes(cli, repoRoot, relPath, wcSide, 'new');
  const oldKind = detectContentKind(oldBytes);
  const newKind = detectContentKind(newBytes);

  if (oldKind.kind === 'lfs-pointer' || newKind.kind === 'lfs-pointer') {
    const oldLfs = oldKind.lfs ?? parseLfsPointer(Buffer.from(oldBytes).toString('utf8'));
    const newLfs = newKind.lfs ?? parseLfsPointer(Buffer.from(newBytes).toString('utf8'));
    const blobs = buildBlobSides(repoRoot, relPath, wcSide, oldBytes, newBytes, oldKind, newKind);
    return {
      kind: 'lfs',
      blobs,
      lfsComparison: { old: oldLfs ?? undefined, new: newLfs ?? undefined },
    };
  }

  const dominantKind: DetectedContentKind =
    oldKind.kind === 'image' || newKind.kind === 'image' ? 'image' : 'binary';
  const blobs = buildBlobSides(repoRoot, relPath, wcSide, oldBytes, newBytes, oldKind, newKind);
  return {
    kind: dominantKind === 'image' ? 'image' : 'binary',
    blobs,
  };
}

export async function readBlobBytes(
  cli: GitCli,
  repoRoot: string,
  relPath: string,
  wcSide: WorkingCopyDiffSide,
  blobSide: 'old' | 'new',
): Promise<Uint8Array> {
  if (wcSide === 'unstaged' && blobSide === 'new') {
    try {
      return new Uint8Array(readFileSync(join(repoRoot, relPath)));
    } catch (error) {
      log.debug(`could not read working copy blob ${relPath}`, error);
      return new Uint8Array();
    }
  }

  const args = blobReadArgs(relPath, wcSide, blobSide);
  try {
    const result = await cli.execRead(args, { binaryStdout: true });
    return result.stdoutBytes ?? new Uint8Array();
  } catch (error) {
    log.debug(`blob read failed ${relPath} ${wcSide} ${blobSide}`, error);
    return new Uint8Array();
  }
}

export async function loadBinaryChunk(
  cli: GitCli,
  repoRoot: string,
  relPath: string,
  wcSide: WorkingCopyDiffSide,
  blobSide: 'old' | 'new',
  offset: number,
  maxBytes: number,
): Promise<BinaryBlobSlice> {
  const bytes = await readBlobBytes(cli, repoRoot, relPath, wcSide, blobSide);
  return sliceBinaryForPostMessage(bytes, offset, maxBytes);
}

function blobReadArgs(relPath: string, wcSide: WorkingCopyDiffSide, blobSide: 'old' | 'new'): string[] {
  if (blobSide === 'new') {
    return ['show', `:${relPath}`];
  }
  return ['show', `HEAD:${relPath}`];
}

function buildBlobSides(
  repoRoot: string,
  relPath: string,
  wcSide: WorkingCopyDiffSide,
  oldBytes: Uint8Array,
  newBytes: Uint8Array,
  oldKind: ReturnType<typeof detectContentKind>,
  newKind: ReturnType<typeof detectContentKind>,
): NonTextBlobSideDto[] {
  return [
    toBlobSideDto(repoRoot, relPath, wcSide, 'old', oldBytes, oldKind),
    toBlobSideDto(repoRoot, relPath, wcSide, 'new', newBytes, newKind),
  ];
}

function toBlobSideDto(
  repoRoot: string,
  relPath: string,
  wcSide: WorkingCopyDiffSide,
  blobSide: 'old' | 'new',
  bytes: Uint8Array,
  kind: ReturnType<typeof detectContentKind>,
): NonTextBlobSideDto {
  const blobRef = buildBlobRef(repoRoot, relPath, wcSide, blobSide);
  return {
    side: blobSide,
    mimeType: kind.mimeType,
    byteLength: bytes.length,
    blobRef,
    inline: bytes.length > 0 ? inlineBytes(bytes, kind) : undefined,
    lfs: kind.lfs,
  };
}

/** A picture that is not huge goes to the view whole, so it draws at once; anything else in slices. */
export function inlineBytes(bytes: Uint8Array, kind: ReturnType<typeof detectContentKind>): BinaryBlobSlice {
  return kind.kind === 'image' && bytes.length <= MAX_IMAGE_PREVIEW_BYTES
    ? sliceBinaryForPostMessage(bytes, 0, bytes.length)
    : sliceBinaryForPostMessage(bytes);
}

async function listSubmoduleCommits(
  cli: GitCli,
  submodulePath: string,
  oldSha: string,
  newSha: string,
): Promise<SubmoduleCommitLine[]> {
  try {
    const result = await cli.execRead([
      'log',
      '--format=%H%x09%s',
      `${oldSha}..${newSha}`,
      '--',
      submodulePath,
    ]);
    const fromPath = parseSubmoduleLogOutput(result.stdout);
    if (fromPath.length > 0) {
      return fromPath;
    }
  } catch (error) {
    log.debug('submodule log by path failed', error);
  }

  try {
    const result = await cli.execRead(['rev-list', '--reverse', `${oldSha}..${newSha}`]);
    return result.stdout
      .split(/\r?\n/)
      .filter((line) => /^[0-9a-f]{7,40}$/i.test(line.trim()))
      .map((sha) => ({ sha: sha.trim(), subject: '(no subject)' }));
  } catch (error) {
    log.warn('submodule rev-list failed', error);
    return [];
  }
}

/** What an untracked file looks like when it is not text: a picture or other bytes that only the working tree has. */
export async function loadUntrackedNonTextSummary(cli: GitCli, repoRoot: string, relPath: string): Promise<NonTextDiffSummary | null> {
  const bytes = await readBlobBytes(cli, repoRoot, relPath, 'unstaged', 'new');
  if (bytes.length === 0) {
    return null;
  }
  const newKind = detectContentKind(bytes);
  if (newKind.kind === 'text') {
    return null;
  }
  const oldBytes = new Uint8Array();
  return {
    kind: newKind.kind === 'image' ? 'image' : 'binary',
    blobs: buildBlobSides(repoRoot, relPath, 'unstaged', oldBytes, bytes, detectContentKind(oldBytes), newKind),
  };
}
