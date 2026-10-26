import * as vscode from 'vscode';
import {
  editorTokenColorsFromRules,
  selectTokenCustomization,
  type EditorTokenColors,
  type TokenColorRule,
} from '../shared/diff/editorTokenColors';
import { parseJsonc } from '../shared/app/jsonc';
import { createLogger } from '../log';

const log = createLogger('editorTheme');

interface ThemeContribution {
  id?: string;
  label?: string;
  path?: string;
}

interface ThemeDocument {
  include?: string;
  tokenColors?: TokenColorRule[] | string;
  colors?: Record<string, string>;
}

function parseThemeJson(text: string): ThemeDocument | undefined {
  try {
    return parseJsonc<ThemeDocument>(text);
  } catch (error) {
    log.warn('color theme JSON could not be parsed', error);
    return undefined;
  }
}

async function readThemeDocument(uri: vscode.Uri): Promise<ThemeDocument | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return parseThemeJson(Buffer.from(bytes).toString('utf8'));
  } catch (error) {
    log.warn('could not read color theme', error);
    return undefined;
  }
}

async function nlsMessages(extension: vscode.Extension<unknown>): Promise<Record<string, string>> {
  try {
    const bytes = await vscode.workspace.fs.readFile(
      vscode.Uri.joinPath(extension.extensionUri, 'package.nls.json'),
    );
    return JSON.parse(Buffer.from(bytes).toString('utf8')) as Record<string, string>;
  } catch (error) {
    log.debug('could not load extension localization messages', error);
    return {};
  }
}

function expandLabel(label: string | undefined, messages: Record<string, string>): string | undefined {
  if (!label) {
    return undefined;
  }
  const match = /^%(.+)%$/.exec(label);
  return match ? messages[match[1]] ?? label : label;
}

async function findThemeUri(themeName: string): Promise<vscode.Uri | undefined> {
  for (const extension of vscode.extensions.all) {
    const themes = extension.packageJSON?.contributes?.themes as ThemeContribution[] | undefined;
    if (!themes?.some((theme) => theme.path)) {
      continue;
    }
    const messages = await nlsMessages(extension);
    const match = themes.find((theme) => {
      const label = expandLabel(theme.label, messages);
      return theme.id === themeName || label === themeName;
    });
    if (match?.path) {
      return vscode.Uri.joinPath(extension.extensionUri, match.path);
    }
  }
  return undefined;
}

async function collectRules(
  uri: vscode.Uri,
  depth: number,
): Promise<{ rules: TokenColorRule[]; foreground?: string }> {
  if (depth > 8) {
    return { rules: [] };
  }
  const document = await readThemeDocument(uri);
  if (!document) {
    return { rules: [] };
  }
  const included =
    typeof document.include === 'string'
      ? await collectRules(vscode.Uri.joinPath(uri, '..', document.include), depth + 1)
      : { rules: [] as TokenColorRule[], foreground: undefined };
  const own = Array.isArray(document.tokenColors) ? document.tokenColors : [];
  return {
    rules: included.rules.concat(own),
    foreground: document.colors?.['editor.foreground'] ?? included.foreground,
  };
}

function activeThemeNames(): string[] {
  const configured = vscode.workspace.getConfiguration('workbench').get<string>('colorTheme');
  const label = (vscode.window.activeColorTheme as { label?: string }).label;
  const names: string[] = [];
  for (const name of [configured, label]) {
    if (name && !names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

/** Reads keyword, string, comment, and related colors from the active color theme. */
export async function readActiveEditorTokenColors(): Promise<EditorTokenColors | undefined> {
  const names = activeThemeNames();
  if (names.length === 0) {
    return undefined;
  }
  let uri: vscode.Uri | undefined;
  let matchedName = names[0]!;
  for (const themeName of names) {
    uri = await findThemeUri(themeName);
    if (uri) {
      matchedName = themeName;
      break;
    }
  }
  if (!uri) {
    log.warn(`no color theme contribution named ${names.join(' or ')}`);
    return undefined;
  }
  const { rules, foreground } = await collectRules(uri, 0);
  const customization = selectTokenCustomization(
    vscode.workspace.getConfiguration('editor').get('tokenColorCustomizations'),
    matchedName,
  );
  return editorTokenColorsFromRules(rules, foreground, customization);
}
