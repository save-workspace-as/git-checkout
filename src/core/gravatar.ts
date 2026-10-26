import { createHash } from 'node:crypto';

export const GRAVATAR_ORIGIN = 'https://www.gravatar.com';

/** `d=404` makes Gravatar fail for unknown emails so the webview falls back to initials. */
export function gravatarUrl(email: string, size = 32): string {
  const hash = createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
  return `${GRAVATAR_ORIGIN}/avatar/${hash}?s=${size}&d=404`;
}
