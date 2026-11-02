import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { changesPagesFor, slotsFor, type SlotName } from './slotTargets';
import type { CommitTreeHostMessage } from '../shared/history/commitTreeProtocol';

describe('slotsFor', () => {
  it('routes commit, working copy, and tree messages to the tabs that show them', () => {
    const cases: [string, SlotName[]][] = [
      ['commitDetailsPreview', ['commit']],
      ['commitComparePreview', ['commit']],
      ['commitDetails', ['commit']],
      ['graphMeta', []],
      ['graphAvatars', []],
      ['commitDetailsFileDiff', ['commit']],
      ['workingCopySnapshot', ['commit', 'changes']],
      ['editorTokenColors', ['commit']],
      ['commitDiffView', ['commit', 'treePreview', 'changes']],
      ['commitDiffNavigate', ['commit']],
      ['commitDetailsShowFile', ['commit']],
      ['state', ['commit']],
      ['commitTreeFilePreview', ['treePreview']],
      ['commitTreePreviewClear', ['treePreview']],
      ['graphPage', []],
      ['rebaseState', []],
      ['rebaseCommitDetails', []],
      ['rebaseCommitDetailsError', []],
      ['operationFormOpen', []],
      ['operationFormUpdate', []],
      ['operationFormClose', []],
    ];
    for (const [type, pane] of cases) {
      assert.deepEqual(slotsFor(type), pane, type);
    }
  });

  it('routes the tree protocol response to the Preview', () => {
    const routes: Record<CommitTreeHostMessage['type'], SlotName> = {
      commitTreeFilePreview: 'treePreview',
      commitTreePreviewClear: 'treePreview',
    };
    for (const [type, target] of Object.entries(routes)) {
      assert.deepEqual(slotsFor(type), [target], type);
    }
  });
});

describe('changesPagesFor', () => {
  it('sends the commit form its own messages, the diff tab its own, and both the rest', () => {
    assert.deepEqual(changesPagesFor('changesGeneratedMessage'), ['form']);
    assert.deepEqual(changesPagesFor('changesCommitted'), ['form']);
    assert.deepEqual(changesPagesFor('changesDiff'), ['diff']);
    assert.deepEqual(changesPagesFor('editorTokenColors'), ['diff']);
    assert.deepEqual(changesPagesFor('workingCopySnapshot'), ['form', 'diff']);
    assert.deepEqual(changesPagesFor('changesView'), ['form', 'diff']);
  });
});
