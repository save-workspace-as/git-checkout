import { strict as assert } from 'node:assert';
import { before, beforeEach, describe, it } from 'node:test';
import { DEFAULT_COMMIT_DIFF_VIEW } from '../../src/shared/diff/commitDiffPresentation';
import type { DiffViewOption } from '../../src/shared/history/pathHistoryProtocol';
import { installDom, resetDom } from '../testing/dom';

type El = HTMLElement & Record<string, any>;
let mountDiffToolbar: typeof import('./diffToolbar').mountDiffToolbar;

before(async () => {
  installDom();
  ({ mountDiffToolbar } = await import('./diffToolbar'));
});
beforeEach(resetDom);

function mount(settings?: { navigation?: boolean; options?: DiffViewOption[] }) {
  const pressed: DiffViewOption[] = [];
  const toolbar = mountDiffToolbar((option) => pressed.push(option), settings);
  document.body.append(toolbar.element);
  const buttons = () => [...toolbar.element.children] as El[];
  const byLabel = (label: string) => buttons().find((button) => button.title === label)!;
  return { toolbar, pressed, buttons, byLabel };
}

describe('diff toolbar', () => {
  it('shows the buttons that switch something on as pressed while it is on', () => {
    const { toolbar, byLabel } = mount();
    toolbar.setOptions({ ...DEFAULT_COMMIT_DIFF_VIEW, wrapLines: true, ignoreWhitespace: false });
    assert.equal(byLabel('Wrap Long Lines').toggleable, true);
    assert.equal(byLabel('Wrap Long Lines').checked, true);
    assert.equal(byLabel('Ignore Whitespace').checked, false);
    assert.equal(byLabel('Show More Lines Around Changes').toggleable, false);
    assert.equal(byLabel('Wrap Long Lines').getAttribute('icon'), 'word-wrap');
  });

  it('reports the option of the button that was pressed', () => {
    const { pressed, byLabel } = mount();
    byLabel('Show Invisible Characters').click();
    byLabel('Side by Side View').click();
    assert.deepEqual(pressed, ['invisibles', 'sideBySide']);
  });

  it('has no previous or next change buttons, adds swap only where asked, and swaps only side by side', () => {
    const titles = mount({ navigation: true }).buttons().map((button) => button.title);
    assert.equal(titles.some((title) => /Previous Change|Next Change/.test(title)), false);
    assert.equal(mount().buttons().some((button) => button.title === 'Swap Left and Right Side'), false);
    const { toolbar, byLabel } = mount({ navigation: true });
    toolbar.setOptions({ ...DEFAULT_COMMIT_DIFF_VIEW, sideBySide: false });
    assert.equal(byLabel('Swap Left and Right Side').style.visibility, 'hidden');
    toolbar.setOptions({ ...DEFAULT_COMMIT_DIFF_VIEW, sideBySide: true });
    assert.equal(byLabel('Swap Left and Right Side').style.visibility, '');
  });

  it('shows only the options a view supports', () => {
    const { buttons } = mount({ options: ['ignoreWhitespace', 'invisibles', 'wrap'] });
    assert.deepEqual(buttons().map((button) => button.title), ['Ignore Whitespace', 'Show Invisible Characters', 'Wrap Long Lines']);
  });
});
