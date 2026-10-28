/** Max raw bytes inlined in a single postMessage payload per blob side. */
export const MAX_INLINE_BINARY_BYTES = 256 * 1024;

/** Largest picture the File Tree preview sends to the webview. */
export const MAX_IMAGE_PREVIEW_BYTES = 8 * 1024 * 1024;

/** Chunk size for lazy binary payload responses. */
export const BINARY_PAYLOAD_CHUNK_BYTES = 128 * 1024;
