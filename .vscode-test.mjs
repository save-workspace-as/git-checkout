import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from '@vscode/test-cli';

const require = createRequire(import.meta.url);
const { createLaunchWorkspace } = require(
  join(dirname(fileURLToPath(import.meta.url)), 'out/e2e/fixtureRepo.js'),
);

function config(label, version) {
  return {
    label,
    version,
    files: 'out/e2e/**/*.e2e.test.js',
    // A .code-workspace keeps a sentinel folder beside the fixture (see e2e/fixtureRepo.ts).
    workspaceFolder: createLaunchWorkspace(),
    // vscode.git is built in; the runner would otherwise try to install it from the marketplace.
    skipExtensionDependencies: true,
    // CI has no GPU. Without these, stable VS Code's renderer is marked
    // unresponsive during startup and the run exits before Mocha starts.
    launchArgs: process.env.CI
      ? ['--disable-workspace-trust', '--disable-gpu', '--disable-dev-shm-usage']
      : ['--disable-workspace-trust'],
    mocha: { ui: 'bdd', timeout: 60_000 },
  };
}

export default defineConfig([config('stable', 'stable'), config('minimum', '1.90.0')]);
