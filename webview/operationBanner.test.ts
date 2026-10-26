import { strict as assert } from 'node:assert';
import { before, beforeEach, describe, it } from 'node:test';
import type { HistoryWebviewMessage, RepoOperationDto } from '../src/shared/history/historyProtocol';
import { installDom, resetDom } from './testing/dom';

type El = HTMLElement & Record<string, any>;
let mountOperationBanner: typeof import('./operationBanner').mountOperationBanner;

before(async () => {
  installDom();
  ({ mountOperationBanner } = await import('./operationBanner'));
});
beforeEach(resetDom);

function mount() {
  const posted: HistoryWebviewMessage[] = [];
  const banner = mountOperationBanner((message) => posted.push(message));
  document.body.append(banner.element);
  const q = (selector: string) => banner.element.querySelector(selector) as El | null;
  const buttons = () => [...banner.element.querySelectorAll('.operation-banner-actions vscode-button')] as El[];
  return { banner, posted, q, buttons };
}

const rebase: RepoOperationDto = {
  active: true, kind: 'rebase', conflicted: true, summary: 'Rebase in progress', conflictCount: 1,
  branch: 'main', target: '7abd451', commit: 'b627fbf', progress: { step: 5, total: 7 },
};

describe('operation banner', () => {
  it('is hidden until an operation is unfinished, and again once it ends', () => {
    const { banner } = mount();
    assert.equal(banner.element.classList.contains('hidden'), true);
    banner.apply(rebase);
    assert.equal(banner.element.classList.contains('hidden'), false);
    banner.apply(undefined);
    assert.equal(banner.element.classList.contains('hidden'), true);
    assert.equal(banner.element.children.length, 0);
  });

  it('shows what is going on, what to do next and how far a rebase got', () => {
    const { banner, q } = mount();
    banner.apply(rebase);
    assert.equal(q('.operation-banner-title')?.textContent, "Rebasing 'main' → '7abd451' (rebased 4/7 commits)");
    assert.equal(q('.operation-banner-message')?.textContent, "Fix 1 conflict with 'b627fbf' and then continue.");
    assert.equal(q('.operation-banner-progress')?.value, 57);
  });

  it('offers Abort and Resolve while files conflict, and Abort and Continue after', () => {
    const { banner, posted, buttons } = mount();
    banner.apply(rebase);
    let [abort, primary] = buttons();
    assert.equal(abort.hasAttribute('secondary'), true);
    assert.equal(primary.textContent?.trim(), 'Resolve');
    abort.click();
    primary.click();
    banner.apply({ ...rebase, conflicted: false, conflictCount: 0 });
    [abort, primary] = buttons();
    assert.equal(primary.textContent?.trim(), 'Continue');
    primary.click();
    assert.deepEqual(posted.map((message) => message.type), ['operationAbort', 'operationResolve', 'operationContinue']);
  });

  it('has no Abort, Resolve or Continue for a bisect, and no progress bar without progress', () => {
    const { banner, q, buttons } = mount();
    banner.apply({ active: true, kind: 'bisect', conflicted: false, summary: 'Bisect in progress' });
    assert.equal(buttons().length, 0);
    assert.equal(q('.operation-banner-progress'), null);
  });
});
