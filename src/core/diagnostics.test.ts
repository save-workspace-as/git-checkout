import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { extensionKindLabel, formatDiagnostics, type WorkspaceDiagnostics } from './diagnostics';
import { WINDOWS_GIT_PATH_REJECTED } from './gitPath';

function sampleDiagnostics(overrides: Partial<WorkspaceDiagnostics> = {}): WorkspaceDiagnostics {
  return {
    bindingState: 'ready',
    remoteName: 'origin',
    extensionKind: 'workspace',
    gitExtensionEnabled: true,
    gitPath: '/usr/bin/git',
    repositories: [{ rootPath: '/proj', headName: 'main' }],
    ...overrides,
  };
}

describe('formatDiagnostics', () => {
  it('includes repository lines and binding summary', () => {
    const text = formatDiagnostics(sampleDiagnostics());
    assert.match(text, /binding: ready/);
    assert.match(text, /remote: origin/);
    assert.match(text, /repositories: 1/);
    assert.match(text, /\/proj  \[main\]/);
  });

  it('adds guidance when git is disabled', () => {
    const text = formatDiagnostics(sampleDiagnostics({ bindingState: 'git_disabled' }));
    assert.match(text, /Do not set git\.enabled to false/);
  });

  it('adds guidance when the git extension is missing', () => {
    const text = formatDiagnostics(sampleDiagnostics({ bindingState: 'git_extension_missing' }));
    assert.match(text, /workspace extension next to vscode\.git/);
  });

  it('explains a rejected Windows git.path', () => {
    const text = formatDiagnostics(
      sampleDiagnostics({ gitPath: null, gitPathWarning: WINDOWS_GIT_PATH_REJECTED }),
    );
    assert.match(text, /git\.path: \(unavailable\)/);
    assert.match(text, /Windows path/);
  });
});

describe('extensionKindLabel', () => {
  it('maps extension kinds', () => {
    assert.equal(extensionKindLabel(2), 'workspace');
    assert.equal(extensionKindLabel(1), 'ui');
    assert.equal(extensionKindLabel(undefined), 'unknown');
  });
});
