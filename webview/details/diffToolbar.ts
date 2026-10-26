import { html, render } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import type { ActionIcon } from '../../src/shared/app/actionIcons';
import type { CommitDiffViewOptions } from '../../src/shared/diff/commitDiffPresentation';
import type { DiffViewOption } from '../../src/shared/history/pathHistoryProtocol';
import { ACTION_ICONS } from '../../src/shared/app/actionIcons';
import * as l10n from '@vscode/l10n';

interface ToolbarButton {
  option: DiffViewOption;
  label: string;
  icon: ActionIcon;
  /** Buttons with a state show it as pressed; the others just act. */
  pressed?: (options: CommitDiffViewOptions) => boolean;
  /** Only shown where the diff can step through its changes. */
  navigation?: boolean;
}

const BUTTONS: readonly ToolbarButton[] = [
  { option: 'swapSides', label: l10n.t('Swap Left and Right Side'), icon: 'swapSides', navigation: true },
  { option: 'ignoreWhitespace', label: l10n.t('Ignore Whitespace'), icon: 'ignoreWhitespace', pressed: (o) => o.ignoreWhitespace },
  { option: 'invisibles', label: l10n.t('Show Invisible Characters'), icon: 'showInvisibles', pressed: (o) => o.showInvisibles },
  { option: 'wrap', label: l10n.t('Wrap Long Lines'), icon: 'wrapLines', pressed: (o) => o.wrapLines },
  { option: 'moreContext', label: l10n.t('Show More Lines Around Changes'), icon: 'moreContext' },
  { option: 'lessContext', label: l10n.t('Show Fewer Lines Around Changes'), icon: 'lessContext' },
  { option: 'fullFile', label: l10n.t('Show Full File'), icon: 'fullFile', pressed: (o) => o.fullFile },
  { option: 'sideBySide', label: l10n.t('Side by Side View'), icon: 'sideBySide', pressed: (o) => o.sideBySide },
];

/**
 * The diff's toolbar, the same in the History modal and the Commit, Changes and Tree tabs: icon buttons
 * at the top right, with the buttons that switch something on shown highlighted while it is on.
 */
export function mountDiffToolbar(
  onOption: (option: DiffViewOption) => void,
  settings: { navigation?: boolean; options?: readonly DiffViewOption[] } = {},
): { element: HTMLElement; setOptions(options: CommitDiffViewOptions): void } {
  const element = document.createElement('vscode-toolbar-container');
  element.className = 'diff-toolbar';
  element.setAttribute('role', 'toolbar');
  element.setAttribute('aria-label', l10n.t('Diff options'));
  const shown = BUTTONS.filter((entry) =>
    entry.navigation ? settings.navigation === true : !settings.options || settings.options.includes(entry.option));
  let current: CommitDiffViewOptions | undefined;

  function paint(): void {
    render(html`${shown.map((entry) => html`
      <vscode-toolbar-button class="diff-toolbar-button" icon=${ACTION_ICONS[entry.icon]} label=${entry.label} title=${entry.label}
        .toggleable=${entry.pressed !== undefined} .checked=${Boolean(current && entry.pressed?.(current))}
        style=${styleMap({ visibility: entry.option === 'swapSides' && current && !current.sideBySide ? 'hidden' : '' })}
        @click=${() => onOption(entry.option)}></vscode-toolbar-button>`)}`, element);
  }

  paint();
  return {
    element,
    // Swapping only means something while the two sides are shown side by side; the button keeps its place.
    setOptions(options: CommitDiffViewOptions): void {
      current = options;
      paint();
    },
  };
}
