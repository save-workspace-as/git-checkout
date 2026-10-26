import { GRAVATAR_ORIGIN } from '../core/gravatar';
import { GITHUB_AVATAR_ORIGIN } from '../features/graph/githubAvatars';

/**
 * Where a webview may load pictures from. `blob:` is an image diff's object URL.
 * GitHub, and Gravatar when that setting is on, are the author pictures.
 */
export function webviewImgSrc(cspSource: string, allowGravatar: boolean): string {
  return [cspSource, 'blob:', ...(allowGravatar ? [GRAVATAR_ORIGIN] : []), GITHUB_AVATAR_ORIGIN].join(' ');
}
