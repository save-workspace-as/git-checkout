import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getL10nJson } from '@vscode/l10n-dev';

const ROOTS = ['src', 'webview'];
const SKIP = /\.test\.ts$|(^|\/)dev\/|serviceTestUtils|scenarioFixtures|gitRepoHarness/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : path.endsWith('.ts') && !SKIP.test(path) ? [path] : [];
  });
}

/** Every string the extension and its webviews pass to `l10n.t()` or `t()`, in a stable order. */
export async function extractL10nBundle(): Promise<Record<string, string>> {
  const files = ROOTS.flatMap(sources).sort().map((path) => ({
    contents: readFileSync(path, 'utf8'),
    extension: '.ts',
  }));
  const extracted = await getL10nJson(files);
  const bundle: Record<string, string> = {};
  for (const key of Object.keys(extracted).sort((left, right) => left.localeCompare(right, 'en'))) {
    const entry = extracted[key];
    bundle[key] = typeof entry === 'string' ? entry : entry.message;
  }
  return bundle;
}

export const BUNDLE_PATH = 'l10n/bundle.l10n.json';

if (process.argv[1]?.endsWith('exportL10n.ts')) {
  void extractL10nBundle().then((bundle) => {
    mkdirSync('l10n', { recursive: true });
    writeFileSync(BUNDLE_PATH, `${JSON.stringify(bundle, null, 2)}\n`);
    console.log(`Wrote ${Object.keys(bundle).length} strings to ${BUNDLE_PATH}`);
  });
}
