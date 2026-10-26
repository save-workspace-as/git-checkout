import * as l10n from '@vscode/l10n';

/**
 * A manifest command title is fixed text, so a command whose wording depends on the operating system
 * is declared three times, each shown only on its own system with the `isMac`, `isWindows` and
 * `isLinux` context keys. The id of the macOS command is the base id; the others add a suffix. All three
 * run the same handler.
 */
export const PLATFORM_VARIANTS = [
  { suffix: '', when: 'isMac', platform: 'darwin' },
  { suffix: '.windows', when: 'isWindows', platform: 'win32' },
  { suffix: '.linux', when: 'isLinux', platform: 'linux' },
] as const;

/** The commands that reveal a file or folder in the system's file manager, by their base id. */
export const REVEAL_COMMAND_BASES = [
  'gitCheckout.file.showInFinder',
  'gitCheckout.changes.reveal',
  'gitCheckout.sidebar.revealWorktree',
  'gitCheckout.sidebar.revealSubmodule',
] as const;

/** The base id followed by the Windows and Linux ids. */
export function platformCommandIds(base: string): string[] {
  return PLATFORM_VARIANTS.map((variant) => `${base}${variant.suffix}`);
}

/**
 * What VS Code itself calls this action on each system. In a remote window the extension runs on another
 * machine than the one showing the window, so its platform says nothing about the right wording: the
 * label is then neutral.
 */
export function revealLabel(platform: string = process.platform, remote = false): string {
  if (remote) {
    return l10n.t('Reveal in File Manager');
  }
  if (platform === 'darwin') {
    return l10n.t('Reveal in Finder');
  }
  if (platform === 'win32') {
    return l10n.t('Reveal in File Explorer');
  }
  return l10n.t('Open Containing Folder');
}
