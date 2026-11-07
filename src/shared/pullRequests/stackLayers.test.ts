import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { defaultEnds, layerBody, layerBranchName, layersOf, type StackCommit } from './stackLayers';

const commit = (sha: string, subject = `Subject ${sha}`, branches: string[] = [], body = ''): StackCommit => ({ sha, subject, body, branches });
const five = ['c1', 'c2', 'c3', 'c4', 'c5'].map((sha) => commit(sha));

describe('layersOf', () => {
  it('joins each commit that ends no layer to the one above it', () => {
    const layers = layersOf(five, new Set(['c1', 'c3', 'c5']));
    assert.deepEqual(layers.map((layer) => [layer.head.sha, layer.commits.map((c) => c.sha)]), [
      ['c1', ['c1']],
      ['c3', ['c2', 'c3']],
      ['c5', ['c4', 'c5']],
    ]);
  });

  it('always ends the top layer at the newest commit, even when it is not chosen', () => {
    const layers = layersOf(five, new Set(['c2']));
    assert.deepEqual(layers.map((layer) => layer.head.sha), ['c2', 'c5']);
    assert.deepEqual(layers[1].commits.map((c) => c.sha), ['c3', 'c4', 'c5']);
  });

  it('makes one layer when nothing is chosen, and none for no commits', () => {
    assert.equal(layersOf(five, new Set()).length, 1);
    assert.deepEqual(layersOf([], new Set(['c1'])), []);
  });

  it('ignores chosen commits that are not in the branch', () => {
    assert.deepEqual(layersOf(five, new Set(['zzz'])).map((layer) => layer.head.sha), ['c5']);
  });
});

describe('defaultEnds', () => {
  it('chooses the newest commit and each commit a branch already ends at', () => {
    const commits = [commit('a'), commit('b', 'B', ['feat/b']), commit('c'), commit('d')];
    assert.deepEqual([...defaultEnds(commits)].sort(), ['b', 'd']);
    assert.deepEqual([...defaultEnds([])], []);
  });
});

describe('layerBody', () => {
  it('carries the body of a one-commit layer, and lists the subjects of a longer one', () => {
    const single = layersOf([commit('a', 'Add schema', [], 'Why it is needed')], new Set())[0];
    const several = layersOf([commit('a', 'First'), commit('b', 'Second')], new Set())[0];
    assert.equal(layerBody(single), 'Why it is needed');
    assert.equal(layerBody(several), '- First\n- Second');
  });
});

describe('layerBranchName', () => {
  it('puts the first words of the subject after the top branch', () => {
    assert.equal(layerBranchName('feat/settings', 'Add the settings schema (v2) for all users now', new Set()), 'feat/settings-add-the-settings-schema-v2');
  });

  it('keeps every name unlike the others', () => {
    const taken = new Set(['feat/x-fix', 'feat/x-fix-2']);
    assert.equal(layerBranchName('feat/x', 'Fix', taken), 'feat/x-fix-3');
  });

  it('has a name for a subject without words', () => {
    assert.equal(layerBranchName('feat/x', '!!!', new Set()), 'feat/x-layer');
  });

  it('cuts a long word short without leaving a trailing hyphen', () => {
    const name = layerBranchName('t', `${'a'.repeat(39)} bbb`, new Set());
    assert.equal(name, `t-${'a'.repeat(39)}`);
  });
});
