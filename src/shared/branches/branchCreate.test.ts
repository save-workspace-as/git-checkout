import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  branchNameInput,
  branchNamePrefix,
  parseBranchNameSeparator,
  parseBranchWhitespaceReplacement,
  replaceBranchWhitespace,
} from './branchCreate';

describe('parseBranchNameSeparator', () => {
  it('accepts slash, hyphen, and underscore', () => {
    assert.equal(parseBranchNameSeparator('/'), '/');
    assert.equal(parseBranchNameSeparator('-'), '-');
    assert.equal(parseBranchNameSeparator('_'), '_');
    assert.equal(parseBranchNameSeparator(' / '), '/');
  });

  it('falls back to slash', () => {
    assert.equal(parseBranchNameSeparator(undefined), '/');
    assert.equal(parseBranchNameSeparator('dot'), '/');
    assert.equal(parseBranchNameSeparator(1), '/');
  });
});

describe('branchNamePrefix', () => {
  it('keeps the current branch prefix through the last separator', () => {
    const cases: [string | null | undefined, '/' | '-' | '_', string][] = [
      ['user/feat/foo', '/', 'user/feat/'],
      ['user/feat/foo/bar', '/', 'user/feat/foo/'],
      ['user-feat-foo', '-', 'user-feat-'],
      ['user_feat_foo', '_', 'user_feat_'],
      ['user/feat/foo', '-', ''],
      ['main', '/', ''],
      ['HEAD', '/', ''],
      [null, '/', ''],
      [undefined, '/', ''],
      ['  user/feat/foo  ', '/', 'user/feat/'],
    ];
    for (const [branch, separator, prefix] of cases) {
      assert.equal(branchNamePrefix(branch, separator), prefix);
    }
  });

  it('places the cursor after the prefilled prefix', () => {
    const input = branchNameInput('user/feat/foo', '/');
    assert.equal(input.value, 'user/feat/');
    assert.deepEqual(input.valueSelection, [input.value.length, input.value.length]);
  });
});

describe('branch name whitespace', () => {
  it('replaces every whitespace character with the configured text', () => {
    assert.equal(replaceBranchWhitespace('build pipeline  fix', '-'), 'build-pipeline--fix');
    assert.equal(replaceBranchWhitespace('a\tb\nc', '_'), 'a_b_c');
    assert.equal(replaceBranchWhitespace('no-spaces', '-'), 'no-spaces');
  });

  it('reads git.branchWhitespaceChar and falls back to a hyphen for anything unusable', () => {
    assert.equal(parseBranchWhitespaceReplacement('_'), '_');
    assert.equal(parseBranchWhitespaceReplacement('.'), '.');
    assert.equal(parseBranchWhitespaceReplacement(''), '');
    assert.equal(parseBranchWhitespaceReplacement(' '), '-');
    assert.equal(parseBranchWhitespaceReplacement('..'), '-');
    assert.equal(parseBranchWhitespaceReplacement(undefined), '-');
    assert.equal(parseBranchWhitespaceReplacement(3), '-');
  });
});
