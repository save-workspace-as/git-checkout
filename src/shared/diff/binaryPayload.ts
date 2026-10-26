import { BINARY_PAYLOAD_CHUNK_BYTES, MAX_INLINE_BINARY_BYTES } from './binaryDiffLimits';

export interface BinaryBlobSlice {
  byteLength: number;
  offset: number;
  chunkByteLength: number;
  dataBase64: string;
  truncated: boolean;
  complete: boolean;
}

export function sliceBinaryForPostMessage(
  bytes: Uint8Array,
  offset = 0,
  maxBytes = MAX_INLINE_BINARY_BYTES,
): BinaryBlobSlice {
  const byteLength = bytes.length;
  const safeOffset = Math.max(0, Math.min(offset, byteLength));
  const end = Math.min(byteLength, safeOffset + maxBytes);
  const chunk = bytes.subarray(safeOffset, end);
  const chunkByteLength = chunk.length;
  const complete = safeOffset + chunkByteLength >= byteLength;
  return {
    byteLength,
    offset: safeOffset,
    chunkByteLength,
    dataBase64: Buffer.from(chunk).toString('base64'),
    truncated: byteLength > MAX_INLINE_BINARY_BYTES,
    complete,
  };
}

export function defaultChunkSize(): number {
  return BINARY_PAYLOAD_CHUNK_BYTES;
}
