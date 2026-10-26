import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const watch = process.argv.includes('--watch');

mkdirSync('media/webview', { recursive: true });

const ctx = await esbuild.context({
  entryPoints: {
    main: 'webview/main.ts',
    commit: 'webview/commitMain.ts',
    changes: 'webview/changesMain.ts',
    commitFiles: 'webview/commitFilesMain.ts',
    tree: 'webview/treeMain.ts',
  },
  bundle: true,
  outdir: 'media/webview',
  entryNames: '[name]',
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  sourcemap: true,
  logLevel: 'info',
});

// The codicon font and its classes ship with the styles, so webview icons are the same ones VS Code draws.
function copyStyles() {
  const codicons = 'node_modules/@vscode/codicons/dist';
  copyFileSync(`${codicons}/codicon.ttf`, 'media/webview/codicon.ttf');
  const font = readFileSync(`${codicons}/codicon.css`, 'utf8');
  // VS Code Elements load the same stylesheet into their icons, through the link named `vscode-codicon-stylesheet`.
  writeFileSync('media/webview/codicon.css', font);
  writeFileSync('media/webview/styles.css', `${font}\n${readFileSync('webview/styles.css', 'utf8')}`);
}

if (watch) {
  copyStyles();
  await ctx.watch();
  console.log('[webview] watching...');
} else {
  await ctx.rebuild();
  copyStyles();
  await ctx.dispose();
}
