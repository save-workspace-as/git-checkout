import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { bisectCheckoutSha, bisectCommitSha, bisectMarkForSha, IDLE_BISECT_STATE } from '../../shared/bisect/bisectProtocol';
import {
  bisectCurrentSha,
  bisectGitTerm,
  bisectMarkFromRef,
  bisectSummary,
  collectBisectMarks,
  parseBisectRefLines,
  parseBisectTerms,
} from './bisectState';

const BAD = '666258eccebbfe8b3edf8d48343c3e2a84f192b2';
const GOOD = '9f443fbaa846b3cd2f37b517348e5042670b752b';
const MID = '84f6e5bfbc7f6f1b0749b4ba7c9ed63d6a32a2e2';
const FIRST = '55ef320f3046deccd92c7be07d6abae7fff5476b';

const LOG = `
# bad: [${BAD}] c5
# good: [${GOOD}] c1
git bisect start
# good: [${MID}] c3
git bisect good ${MID}
# bad: [${FIRST}] c4
git bisect bad ${FIRST}
# first 'bad' commit: [${FIRST}] c4
`;

describe('bisect state parsing', () => {
  it('reads default and custom terms', () => {
    assert.deepEqual(parseBisectTerms('bad\ngood\n'), { bad: 'bad', good: 'good' });
    assert.deepEqual(parseBisectTerms('new\nold\n'), { bad: 'new', good: 'old' });
    assert.deepEqual(parseBisectTerms(''), { bad: 'bad', good: 'good' });
  });

  it('maps toolbar marks onto the session terms', () => {
    const terms = { bad: 'new', good: 'old' };
    assert.equal(bisectGitTerm('good', terms), 'old');
    assert.equal(bisectGitTerm('bad', terms), 'new');
    assert.equal(bisectGitTerm('skip', terms), 'skip');
  });

  it('classifies bisect refs, including old/new terms', () => {
    assert.equal(bisectMarkFromRef(`refs/bisect/bad`), 'bad');
    assert.equal(bisectMarkFromRef(`refs/bisect/good-${GOOD}`), 'good');
    assert.equal(bisectMarkFromRef(`refs/bisect/skip-${MID}`), 'skip');
    assert.equal(bisectMarkFromRef(`refs/bisect/old-${GOOD}`), 'good');
    assert.equal(bisectMarkFromRef('refs/heads/main'), null);
  });

  it('parses for-each-ref lines', () => {
    const stdout = `${BAD} refs/bisect/bad\n${GOOD} refs/bisect/good-${GOOD}\n`;
    assert.deepEqual(parseBisectRefLines(stdout), [
      { sha: BAD, refname: 'refs/bisect/bad' },
      { sha: GOOD, refname: `refs/bisect/good-${GOOD}` },
    ]);
    assert.deepEqual(parseBisectRefLines(''), []);
  });

  it('prefers the expected revision over HEAD and falls back when it is missing', () => {
    assert.equal(bisectCurrentSha(MID, BAD), MID);
    assert.equal(bisectCurrentSha('', BAD), BAD);
    assert.equal(bisectCurrentSha('not-a-sha', null), null);
  });

  it('collects every good, bad, and skip commit from the log and refs', () => {
    const marks = collectBisectMarks(LOG, [
      { sha: FIRST, refname: 'refs/bisect/bad' },
      { sha: MID, refname: `refs/bisect/good-${MID}` },
      { sha: GOOD, refname: `refs/bisect/good-${GOOD}` },
      { sha: 'abcdef1', refname: 'refs/bisect/skip-abcdef1' },
    ]);
    assert.equal(marks.firstBadSha, FIRST);
    assert.deepEqual(marks.bad, [BAD, FIRST].sort());
    assert.deepEqual(marks.good, [GOOD, MID].sort());
    assert.deepEqual(marks.skip, ['abcdef1']);
  });

  it('describes the commit under test and the first bad commit', () => {
    assert.equal(bisectSummary(false, MID, null), '');
    assert.equal(bisectSummary(true, MID, null), `Testing ${MID.slice(0, 7)}`);
    assert.equal(bisectSummary(true, FIRST, FIRST), `First bad commit ${FIRST.slice(0, 7)}`);
    assert.equal(bisectSummary(true, null, null), 'Bisect in progress');
    assert.equal(bisectSummary(true, MID, null, true), 'Only skipped commits left to test');
  });

  it('notices when every remaining commit was skipped', () => {
    const marks = collectBisectMarks(
      `# skip: [${MID}] c3\n# only skipped commits left to test\n`,
      [],
    );
    assert.equal(marks.onlySkipped, true);
    assert.deepEqual(marks.skip, [MID]);
  });
});

describe('bisect graph selection', () => {
  it('selects the commit under test while a session is active', () => {
    assert.equal(bisectCheckoutSha(IDLE_BISECT_STATE), null);
    assert.equal(
      bisectCheckoutSha({ ...IDLE_BISECT_STATE, active: true, currentSha: MID }),
      MID,
    );
  });

  it('colors bad ahead of skip and good', () => {
    const state = {
      ...IDLE_BISECT_STATE,
      active: true,
      good: [GOOD, MID],
      bad: [BAD],
      skip: [MID],
    };
    assert.equal(bisectMarkForSha(state, BAD), 'bad');
    assert.equal(bisectMarkForSha(state, MID), 'skip');
    assert.equal(bisectMarkForSha(state, GOOD), 'good');
    assert.equal(bisectMarkForSha(state, 'ffffff1'), null);
  });

  it('reads a graph context sha and ignores title-bar invocations', () => {
    assert.equal(bisectCommitSha(undefined), undefined);
    assert.equal(bisectCommitSha({ command: 'gitCheckout.bisect.good' }), undefined);
    assert.equal(
      bisectCommitSha({ webviewSection: 'commit', sha: `  ${MID}  ` }),
      MID,
    );
  });
});
