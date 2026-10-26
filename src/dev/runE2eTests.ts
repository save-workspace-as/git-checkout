import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { filterTestFiles, splitTestArgs } from './nodeTestFiles';

const VALUE_FLAGS = new Set(['--grep', '-g', '--fgrep', '-f', '--label', '-l', '--code-version', '--timeout', '-t', '--retries', '-r']);

const { filters, flags } = splitTestArgs(process.argv.slice(2), VALUE_FLAGS);
const all = readdirSync('e2e').filter((name) => name.endsWith('.e2e.test.ts')).sort();
const selected = filterTestFiles(all, filters);
if (selected.length === 0) {
  console.error(`No e2e tests match ${filters.join(', ')}`);
  process.exit(1);
}

// Compiled by `tsc -p tsconfig.e2e.json` into out/e2e before this runs.
const run = filters.length > 0 ? selected.flatMap((name) => ['--run', `out/e2e/${name.replace(/\.ts$/, '.js')}`]) : [];
const cli = join('node_modules', '@vscode', 'test-cli', 'out', 'bin.mjs');
const result = spawnSync(process.execPath, [cli, ...flags, ...run], { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
