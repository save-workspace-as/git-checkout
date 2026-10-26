import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

import { filterTestFiles, listNodeTestFiles, splitTestArgs, type NodeTestKind } from './nodeTestFiles';

function isNodeTestKind(value: string | undefined): value is NodeTestKind {
  return value === 'unit' || value === 'integration';
}

const [kind, ...rest] = process.argv.slice(2);
if (!isNodeTestKind(kind)) {
  console.error('Usage: runNodeTests.ts <unit|integration> [file-filter...] [--test-name-pattern <regex>]');
  process.exit(1);
}

// Node 20's test runner does not expand globs. CI runs these suites on Node 20 and 22.
const { filters, flags } = splitTestArgs(rest, new Set(['--test-name-pattern', '--test-skip-pattern']));
// Tests sit beside the code they test: the extension's under `src`, the webviews' under `webview`.
const files = filterTestFiles([...listNodeTestFiles('src', kind), ...listNodeTestFiles('webview', kind)], filters);
if (files.length === 0) {
  console.error(filters.length > 0 ? `No ${kind} tests match ${filters.join(', ')}` : `No ${kind} tests under src or webview`);
  process.exit(1);
}

const require = createRequire(__filename);
const tsxCli = require.resolve('tsx/cli');
const result = spawnSync(process.execPath, [tsxCli, '--test', ...flags, ...files], { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
