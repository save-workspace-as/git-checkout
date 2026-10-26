import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildWorkingCopyDiffArgs } from './gitDiffArgs';
import { DEFAULT_WORKING_COPY_DIFF_VIEW_OPTIONS } from '../shared/diff/diffViewOptions';

describe('buildWorkingCopyDiffArgs', () => {
  it('adds ignore-whitespace flag when requested', () => {
    const args = buildWorkingCopyDiffArgs('unstaged', 'file.txt', {
      ...DEFAULT_WORKING_COPY_DIFF_VIEW_OPTIONS,
      whitespace: 'ignore',
    });
    assert.deepEqual(args, ['diff', '--no-color', '-w', '--', 'file.txt']);
  });

  it('uses cached diff for staged side', () => {
    const args = buildWorkingCopyDiffArgs('staged', 'x/y', DEFAULT_WORKING_COPY_DIFF_VIEW_OPTIONS);
    assert.deepEqual(args, ['diff', '--cached', '--no-color', '--', 'x/y']);
  });
});
