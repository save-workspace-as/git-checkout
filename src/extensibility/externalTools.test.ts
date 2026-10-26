import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  decideExternalTool,
  externalToolGitArgs,
  externalToolRemoteWarning,
  pickConfiguredTool,
} from './externalTools';

describe('pickConfiguredTool', () => {
  it('prefers the GUI tool and treats blanks as unset', () => {
    assert.equal(pickConfiguredTool('meld', 'vimdiff'), 'meld');
    assert.equal(pickConfiguredTool('  ', 'vimdiff'), 'vimdiff');
    assert.equal(pickConfiguredTool(null, ' '), null);
  });
});

describe('externalToolGitArgs', () => {
  it('asks difftool for a GUI and limits paths', () => {
    assert.deepEqual(externalToolGitArgs('diff', ['src/a.ts']), [
      'difftool',
      '--no-prompt',
      '-g',
      '--',
      'src/a.ts',
    ]);
  });

  it('compares two commits when revisions are given', () => {
    assert.deepEqual(externalToolGitArgs('diff', ['src/a.ts'], ['base', 'head']), [
      'difftool', '--no-prompt', '-g', 'base', 'head', '--', 'src/a.ts',
    ]);
    assert.deepEqual(externalToolGitArgs('merge', ['a.ts'], ['x', 'y']), ['mergetool', '--no-prompt', '--', 'a.ts']);
  });

  it('runs mergetool for the whole conflict set when no path is given', () => {
    assert.deepEqual(externalToolGitArgs('merge', []), ['mergetool', '--no-prompt']);
  });
});

describe('externalToolRemoteWarning', () => {
  it('warns only when the workspace is remote', () => {
    assert.equal(externalToolRemoteWarning(null, 'diff'), null);
    assert.match(externalToolRemoteWarning('ssh-remote', 'merge') ?? '', /workspace host \(ssh-remote\)/);
  });
});

describe('decideExternalTool', () => {
  it('keeps in-app diffs when the opt-in is off', () => {
    const decision = decideExternalTool({
      kind: 'diff',
      enabled: false,
      remoteName: 'wsl',
      configuredTool: 'meld',
      paths: [],
    });
    assert.equal(decision.status, 'disabled');
    if (decision.status === 'disabled') {
      assert.match(decision.message, /In-app diff stays the default/);
    }
  });

  it('refuses to launch when git has no tool configured', () => {
    const decision = decideExternalTool({
      kind: 'merge',
      enabled: true,
      remoteName: null,
      configuredTool: null,
      paths: [],
    });
    assert.equal(decision.status, 'unconfigured');
  });

  it('is ready to launch on the workspace host', () => {
    const decision = decideExternalTool({
      kind: 'diff',
      enabled: true,
      remoteName: 'dev-container',
      configuredTool: 'meld',
      paths: ['README.md'],
    });
    assert.equal(decision.status, 'ready');
    if (decision.status === 'ready') {
      assert.deepEqual(decision.plan.args, ['difftool', '--no-prompt', '-g', '--', 'README.md']);
      assert.match(decision.plan.remoteWarning ?? '', /dev-container/);
    }
  });
});
