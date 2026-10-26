import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { branchFromRef, readOperationDetails } from './operationDetails';

const FULL = (prefix: string): string => prefix.padEnd(40, '0');

describe('readOperationDetails', () => {
  let gitDir: string;
  beforeEach(() => { gitDir = mkdtempSync(join(tmpdir(), 'git-checkout-details-')); });
  afterEach(() => rmSync(gitDir, { recursive: true, force: true }));

  const put = (name: string, text: string): void => {
    mkdirSync(join(gitDir, name, '..'), { recursive: true });
    writeFileSync(join(gitDir, name), `${text}\n`);
  };

  it('reads which branch a rebase is moving, onto what, how far it got and where it stopped', () => {
    put('rebase-merge/head-name', 'refs/heads/feature/login');
    put('rebase-merge/onto', FULL('7abd451'));
    put('rebase-merge/msgnum', '5');
    put('rebase-merge/end', '7');
    put('REBASE_HEAD', FULL('b627fbf'));
    assert.deepEqual(readOperationDetails(gitDir, 'rebase'), {
      branch: 'feature/login',
      target: '7abd451',
      commit: 'b627fbf',
      progress: { step: 5, total: 7 },
    });
  });

  it('reads an apply-style rebase the same way', () => {
    put('rebase-apply/head-name', 'refs/heads/topic');
    put('rebase-apply/onto', FULL('1234567'));
    put('rebase-apply/next', '2');
    put('rebase-apply/last', '3');
    assert.deepEqual(readOperationDetails(gitDir, 'rebase'), {
      branch: 'topic',
      target: '1234567',
      commit: undefined,
      progress: { step: 2, total: 3 },
    });
  });

  it('leaves out progress that is missing or makes no sense, and keeps the step within the total', () => {
    put('rebase-merge/head-name', 'refs/heads/topic');
    put('rebase-merge/msgnum', '9');
    put('rebase-merge/end', '4');
    assert.deepEqual(readOperationDetails(gitDir, 'rebase').progress, { step: 4, total: 4 });
    rmSync(join(gitDir, 'rebase-merge/end'));
    assert.equal(readOperationDetails(gitDir, 'rebase').progress, undefined);
  });

  it('names the commit a merge, cherry-pick or revert brings in', () => {
    put('MERGE_HEAD', FULL('aaaaaaa'));
    put('CHERRY_PICK_HEAD', FULL('bbbbbbb'));
    put('REVERT_HEAD', FULL('ccccccc'));
    assert.deepEqual(readOperationDetails(gitDir, 'merge'), { target: 'aaaaaaa' });
    assert.deepEqual(readOperationDetails(gitDir, 'cherry-pick'), { target: 'bbbbbbb' });
    assert.deepEqual(readOperationDetails(gitDir, 'revert'), { target: 'ccccccc' });
  });

  it('has nothing to say for bisect, nothing in progress, or files that are not there', () => {
    assert.deepEqual(readOperationDetails(gitDir, 'bisect'), {});
    assert.deepEqual(readOperationDetails(gitDir, null), {});
    assert.deepEqual(readOperationDetails(gitDir, 'merge'), { target: undefined });
  });
});

describe('branchFromRef', () => {
  it('drops refs/heads/ and leaves anything else alone', () => {
    assert.equal(branchFromRef('refs/heads/main'), 'main');
    assert.equal(branchFromRef('detached HEAD'), 'detached HEAD');
    assert.equal(branchFromRef(undefined), undefined);
  });
});
