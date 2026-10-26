import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { gravatarUrl } from './gravatar';

describe('gravatarUrl', () => {
  it('hashes the trimmed, lower-cased email with SHA-256', () => {
    assert.equal(
      gravatarUrl(' MyEmailAddress@example.com '),
      'https://www.gravatar.com/avatar/84059b07d4be67b806386c0aad8070a23f18836bbaae342275dc0a83414c32ee?s=32&d=404',
    );
  });
});
