import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { bottomViewsFor, type BottomView } from './bottomViewTarget';
import type { CommitTreeHostMessage } from '../shared/history/commitTreeProtocol';

describe('bottomViewsFor', () => {
  it('routes commit, working copy, and tree messages to the bottom panel', () => {
    const cases: [string, BottomView[]][] = [
      ['commitDetailsPreview', ['commit', 'files']],
      ['commitComparePreview', ['commit', 'files']],
      ['commitDetails', ['commit', 'files']],
      ['graphMeta', ['files']],
      ['graphAvatars', ['files']],
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
      assert.deepEqual(bottomViewsFor(type), pane, type);
    }
  });

  it('routes the tree protocol response to the Preview', () => {
    const routes: Record<CommitTreeHostMessage['type'], BottomView> = {
      commitTreeFilePreview: 'treePreview',
      commitTreePreviewClear: 'treePreview',
    };
    for (const [type, target] of Object.entries(routes)) {
      assert.deepEqual(bottomViewsFor(type), [target], type);
    }
  });
});
