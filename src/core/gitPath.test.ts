import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  isWindowsAbsoluteGitPath,
  resolveWorkspaceGitPath,
  WINDOWS_GIT_PATH_REJECTED,
} from './gitPath';

describe('isWindowsAbsoluteGitPath', () => {
  it('recognizes drive-letter and UNC paths', () => {
    const windowsPaths = [
      String.raw`C:\Program Files\Git\cmd\git.exe`,
      'C:/Program Files/Git/cmd/git.exe',
      'c:/git/cmd/git.exe',
      String.raw`\\server\share\git.exe`,
    ];
    for (const gitPath of windowsPaths) {
      assert.equal(isWindowsAbsoluteGitPath(gitPath), true, gitPath);
    }
    assert.equal(isWindowsAbsoluteGitPath('/usr/bin/git'), false);
    assert.equal(isWindowsAbsoluteGitPath('git'), false);
    assert.equal(isWindowsAbsoluteGitPath(''), false);
  });
});

describe('resolveWorkspaceGitPath', () => {
  const windowsGit = String.raw`C:\Program Files\Git\cmd\git.exe`;

  it('keeps api.git.path on the host that can run it', () => {
    assert.deepEqual(resolveWorkspaceGitPath('/usr/bin/git', 'linux'), {
      path: '/usr/bin/git',
      warning: null,
    });
    assert.deepEqual(resolveWorkspaceGitPath(windowsGit, 'win32'), {
      path: windowsGit,
      warning: null,
    });
    assert.deepEqual(resolveWorkspaceGitPath('  /usr/bin/git  ', 'darwin'), {
      path: '/usr/bin/git',
      warning: null,
    });
  });

  it('rejects a Windows User git.path on WSL, SSH, and Dev Container hosts', () => {
    for (const hostPlatform of ['linux', 'darwin'] as const) {
      assert.deepEqual(resolveWorkspaceGitPath(windowsGit, hostPlatform), {
        path: null,
        warning: WINDOWS_GIT_PATH_REJECTED,
      });
      assert.deepEqual(resolveWorkspaceGitPath('C:/Program Files/Git/cmd/git.exe', hostPlatform), {
        path: null,
        warning: WINDOWS_GIT_PATH_REJECTED,
      });
    }
  });

  it('returns null when vscode.git has no path', () => {
    for (const apiGitPath of [null, undefined, '', '   ']) {
      assert.deepEqual(resolveWorkspaceGitPath(apiGitPath, 'linux'), {
        path: null,
        warning: null,
      });
    }
  });
});
