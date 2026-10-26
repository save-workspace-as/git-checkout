import * as esbuild from 'esbuild';
import { mkdirSync } from 'node:fs';

const watch = process.argv.includes('--watch');

mkdirSync('dist', { recursive: true });

const ctx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  sourcemap: true,
  external: ['vscode'],
  logLevel: 'info',
});

if (watch) {
  await ctx.watch();
  console.log('[extension] watching...');
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
