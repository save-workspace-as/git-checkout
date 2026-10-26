import * as l10n from '@vscode/l10n';
import { readFile, stat, writeFile } from 'node:fs/promises';
import * as path from 'path';

export interface GitignoreTemplate {
  id: string;
  label: string;
  patterns: readonly string[];
}

export const GITIGNORE_TEMPLATES: readonly GitignoreTemplate[] = [
  {
    id: 'node',
    label: l10n.t('Node'),
    patterns: ['# Git Checkout: Node', 'node_modules/', 'dist/', '*.log', 'npm-debug.log*'],
  },
  {
    id: 'python',
    label: l10n.t('Python'),
    patterns: ['# Git Checkout: Python', '__pycache__/', '*.py[cod]', '.venv/', 'venv/'],
  },
  {
    id: 'vscode',
    label: l10n.t('Visual Studio Code'),
    patterns: [
      '# Git Checkout: Visual Studio Code',
      '.vscode/*',
      '!.vscode/settings.json',
      '!.vscode/tasks.json',
      '!.vscode/launch.json',
      '!.vscode/extensions.json',
    ],
  },
  {
    id: 'macos',
    label: l10n.t('macOS'),
    patterns: ['# Git Checkout: macOS', '.DS_Store'],
  },
  {
    id: 'go',
    label: l10n.t('Go'),
    patterns: ['# Git Checkout: Go', '*.exe', '*.test', 'vendor/'],
  },
  {
    id: 'rust',
    label: l10n.t('Rust'),
    patterns: ['# Git Checkout: Rust', '/target/'],
  },
  {
    id: 'java',
    label: l10n.t('Java'),
    patterns: ['# Git Checkout: Java', '*.class', 'target/'],
  },
];

export function gitignoreTemplateById(id: string): GitignoreTemplate | undefined {
  return GITIGNORE_TEMPLATES.find((template) => template.id === id);
}

export function gitignorePattern(relativePosix: string, isDirectory: boolean): string {
  if (isDirectory && !relativePosix.endsWith('/')) {
    return `${relativePosix}/`;
  }
  return relativePosix;
}

export function appendGitignorePatterns(
  existing: string,
  patterns: readonly string[],
): { text: string; added: string[] } {
  const present = new Set(
    existing
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  );
  const added: string[] = [];
  for (const pattern of patterns) {
    const trimmed = pattern.trim();
    if (!trimmed || present.has(trimmed)) {
      continue;
    }
    present.add(trimmed);
    added.push(trimmed);
  }
  if (added.length === 0) {
    return { text: existing, added };
  }
  const newline = existing.includes('\r\n') ? '\r\n' : '\n';
  const base =
    existing.length === 0 ? '' : existing.endsWith('\n') ? existing : `${existing}${newline}`;
  return { text: `${base}${added.join(newline)}${newline}`, added };
}

export async function writeGitignorePatterns(
  repoRoot: string,
  patterns: readonly string[],
): Promise<string[]> {
  const filePath = path.join(repoRoot, '.gitignore');
  let existing = '';
  try {
    existing = await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  const result = appendGitignorePatterns(existing, patterns);
  if (result.added.length === 0) {
    return [];
  }
  await writeFile(filePath, result.text, 'utf8');
  return result.added;
}

export async function isDirectoryPath(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}
