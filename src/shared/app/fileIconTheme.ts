/** One icon in a VS Code file icon theme: an image, or a glyph from one of the theme's fonts. */
export interface IconDefinition {
  iconPath?: string;
  fontCharacter?: string;
  fontColor?: string;
  fontSize?: string;
  fontId?: string;
}

export interface IconThemeSection {
  file?: string;
  folder?: string;
  folderExpanded?: string;
  fileExtensions?: Record<string, string>;
  fileNames?: Record<string, string>;
  folderNames?: Record<string, string>;
  folderNamesExpanded?: Record<string, string>;
  languageIds?: Record<string, string>;
}

export interface IconThemeFont {
  id: string;
  src: { path: string; format: string }[];
  weight?: string;
  style?: string;
  size?: string;
}

export interface IconThemeDocument extends IconThemeSection {
  iconDefinitions?: Record<string, IconDefinition>;
  fonts?: IconThemeFont[];
  light?: IconThemeSection;
  highContrast?: IconThemeSection;
}

export type IconThemeKind = 'dark' | 'light' | 'highContrast';

export interface IconQuery {
  /** Base name of the file or folder. */
  name: string;
  directory: boolean;
  expanded?: boolean;
  languageId?: string;
}

/**
 * The icon the theme assigns, following VS Code's order: exact file name, then the longest matching
 * extension, then the file's language, then the theme's default. Light and high-contrast sections
 * override the base section.
 */
export function resolveIconId(
  theme: IconThemeDocument,
  query: IconQuery,
  kind: IconThemeKind,
): string | undefined {
  const overlay = kind === 'light' ? theme.light : kind === 'highContrast' ? theme.highContrast : undefined;
  const pick = <K extends keyof IconThemeSection>(key: K): IconThemeSection[K] | undefined => overlay?.[key] ?? theme[key];
  const lookup = (key: 'fileNames' | 'fileExtensions' | 'folderNames' | 'folderNamesExpanded' | 'languageIds', name: string) =>
    overlay?.[key]?.[name] ?? theme[key]?.[name];
  const lower = query.name.toLowerCase();

  if (query.directory) {
    if (query.expanded) {
      return lookup('folderNamesExpanded', lower) ?? lookup('folderNames', lower) ?? pick('folderExpanded') ?? pick('folder');
    }
    return lookup('folderNames', lower) ?? pick('folder');
  }
  const byName = lookup('fileNames', lower);
  if (byName) {
    return byName;
  }
  // `a.b.c` tries `b.c`, then `c`; a leading dot counts, so `.gitignore` is the extension `gitignore`.
  const parts = lower.split('.');
  for (let start = 1; start < parts.length; start += 1) {
    const byExtension = lookup('fileExtensions', parts.slice(start).join('.'));
    if (byExtension) {
      return byExtension;
    }
  }
  const byLanguage = query.languageId ? lookup('languageIds', query.languageId) : undefined;
  return byLanguage ?? pick('file');
}

export function iconThemeKind(colorThemeKind: 1 | 2 | 3 | 4): IconThemeKind {
  return colorThemeKind === 1 ? 'light' : colorThemeKind === 2 ? 'dark' : 'highContrast';
}

/** Themes write a glyph as an escaped code point such as `\\E023`; a literal character is kept as is. */
export function decodeFontCharacter(value: string): string {
  const escaped = /^\\([0-9a-fA-F]{1,6})$/.exec(value);
  return escaped ? String.fromCodePoint(Number.parseInt(escaped[1], 16)) : value;
}
