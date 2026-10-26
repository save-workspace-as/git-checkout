import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  customCommandNeedsRepo,
  customCommandVarKeys,
  expandCustomCommand,
  parseCustomCommands,
  parseOpenableUrl,
} from './customCommands';

describe('parseCustomCommands', () => {
  it('keeps complete branch, file, submodule, and url commands', () => {
    const commands = parseCustomCommands([
      { name: 'Push branch', command: 'git push origin ${branch}', context: 'branch' },
      { name: 'Blame', command: 'git blame ${file}', context: 'file' },
      { name: 'Update', command: 'git submodule update ${submodule}', context: 'submodule' },
      { name: 'Open PR', command: 'https://example.com/${branch}', context: 'url' },
    ]);
    assert.equal(commands.length, 4);
    assert.deepEqual(
      commands.map((command) => command.context),
      ['branch', 'file', 'submodule', 'url'],
    );
  });

  it('drops malformed entries and blank names', () => {
    const commands = parseCustomCommands([
      null,
      'nope',
      { name: ' ', command: 'echo', context: 'branch' },
      { name: 'Missing', command: 'echo', context: 'commit' },
      { name: 'Ok', command: 'echo ${file}', context: 'file' },
    ]);
    assert.deepEqual(commands, [{ name: 'Ok', command: 'echo ${file}', context: 'file' }]);
  });

  it('returns nothing for a non-array setting', () => {
    assert.deepEqual(parseCustomCommands(undefined), []);
    assert.deepEqual(parseCustomCommands({ name: 'x' }), []);
  });
});

describe('customCommandVarKeys', () => {
  it('includes the context variable and every placeholder', () => {
    assert.deepEqual(
      customCommandVarKeys({
        name: 'PR',
        command: 'https://example.com/${repo}/pull/${branch}',
        context: 'url',
      }),
      ['repo', 'branch'],
    );
    assert.deepEqual(
      customCommandVarKeys({ name: 'File', command: 'echo ${sha}', context: 'file' }),
      ['file', 'sha'],
    );
  });
});

describe('expandCustomCommand', () => {
  it('substitutes shell values and leaves unknown placeholders', () => {
    const expanded = expandCustomCommand(
      'git push origin ${branch} ${missing}',
      { branch: 'feature/one' },
      false,
    );
    assert.equal(expanded, 'git push origin feature/one ${missing}');
  });

  it('encodes URL values and strips newlines', () => {
    const expanded = expandCustomCommand(
      'https://git.example/${branch}',
      { branch: 'feature/one\n;touch /tmp/x' },
      true,
    );
    assert.equal(expanded, 'https://git.example/feature%2Fone%3Btouch%20%2Ftmp%2Fx');
  });
});

describe('parseOpenableUrl', () => {
  it('accepts http and https URLs', () => {
    assert.equal(parseOpenableUrl('https://example.com/pull/1'), 'https://example.com/pull/1');
  });

  it('rejects shell commands and other protocols', () => {
    assert.equal(parseOpenableUrl('git push origin main'), null);
    assert.equal(parseOpenableUrl('file:///etc/passwd'), null);
  });
});

describe('customCommandNeedsRepo', () => {
  it('requires a repository except for a URL with no repo placeholders', () => {
    assert.equal(
      customCommandNeedsRepo({ name: 'Site', command: 'https://example.com', context: 'url' }),
      false,
    );
    assert.equal(
      customCommandNeedsRepo({
        name: 'PR',
        command: 'https://example.com/${branch}',
        context: 'url',
      }),
      true,
    );
    assert.equal(
      customCommandNeedsRepo({ name: 'Branch', command: 'echo hi', context: 'branch' }),
      true,
    );
  });
});
