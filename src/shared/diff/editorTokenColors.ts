/** Colors taken from the active editor theme's TextMate rules. */
export interface EditorTokenColors {
  foreground: string;
  keyword: string;
  string: string;
  number: string;
  comment: string;
  type: string;
  function: string;
  variable: string;
  /** `italic` when the theme's comment rule sets that font style. */
  commentStyle: 'italic' | 'normal';
}

export interface TokenColorRule {
  scope?: string | string[];
  settings?: { foreground?: string; fontStyle?: string };
}

export interface TokenColorCustomization {
  comments?: string;
  strings?: string;
  keywords?: string;
  numbers?: string;
  types?: string;
  functions?: string;
  variables?: string;
  textMateRules?: TokenColorRule[];
}

const FALLBACK = 'var(--vscode-editor-foreground)';

function ruleMatches(scopeField: string | string[], token: string): boolean {
  const parts = Array.isArray(scopeField) ? scopeField : [scopeField];
  for (const part of parts) {
    for (const alternative of part.split(',')) {
      const segments = alternative.trim().split(/\s+/).filter((segment) => segment.length > 0);
      if (
        segments.length > 0 &&
        segments.every((segment) => token === segment || token.startsWith(`${segment}.`))
      ) {
        return true;
      }
    }
  }
  return false;
}

function paint(
  token: string,
  rules: TokenColorRule[],
  fallback: string,
): { color: string; italic: boolean } {
  let color = fallback;
  let italic = false;
  for (const rule of rules) {
    const foreground = rule.settings?.foreground;
    const style = rule.settings?.fontStyle;
    const applies = rule.scope === undefined || ruleMatches(rule.scope, token);
    if (!applies) {
      continue;
    }
    if (foreground) {
      color = foreground;
      italic = style?.includes('italic') ?? false;
    } else if (style) {
      italic = style.includes('italic');
    }
  }
  return { color, italic };
}

/**
 * Maps TextMate rules (theme order, then user customizations) onto the
 * highlight classes the commit diff uses.
 */
export function editorTokenColorsFromRules(
  rules: TokenColorRule[],
  foreground: string | undefined,
  customization?: TokenColorCustomization,
): EditorTokenColors {
  const base = foreground && foreground.length > 0 ? foreground : FALLBACK;
  const combined = customization?.textMateRules ? rules.concat(customization.textMateRules) : rules;
  const keyword = paint('keyword', combined, base);
  const stringColor = paint('string', combined, base);
  const number = paint('constant.numeric', combined, base);
  const comment = paint('comment', combined, base);
  const type = paint('entity.name.type', combined, base);
  const fn = paint('entity.name.function', combined, base);
  const variable = paint('variable', combined, base);
  const named: Partial<EditorTokenColors> = {
    comment: customization?.comments,
    string: customization?.strings,
    keyword: customization?.keywords,
    number: customization?.numbers,
    type: customization?.types,
    function: customization?.functions,
    variable: customization?.variables,
  };
  return {
    foreground: base,
    keyword: named.keyword || keyword.color,
    string: named.string || stringColor.color,
    number: named.number || number.color,
    comment: named.comment || comment.color,
    type: named.type || type.color,
    function: named.function || fn.color,
    variable: named.variable || variable.color,
    commentStyle: comment.italic ? 'italic' : 'normal',
  };
}

/** Picks the theme-specific block from `editor.tokenColorCustomizations` when present. */
export function selectTokenCustomization(
  value: unknown,
  themeName: string,
): TokenColorCustomization | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const themed = record[`[${themeName}]`];
  const source =
    themed && typeof themed === 'object' ? (themed as Record<string, unknown>) : record;
  const textMateRules = Array.isArray(source.textMateRules)
    ? (source.textMateRules as TokenColorRule[])
    : undefined;
  return {
    comments: typeof source.comments === 'string' ? source.comments : undefined,
    strings: typeof source.strings === 'string' ? source.strings : undefined,
    keywords: typeof source.keywords === 'string' ? source.keywords : undefined,
    numbers: typeof source.numbers === 'string' ? source.numbers : undefined,
    types: typeof source.types === 'string' ? source.types : undefined,
    functions: typeof source.functions === 'string' ? source.functions : undefined,
    variables: typeof source.variables === 'string' ? source.variables : undefined,
    textMateRules,
  };
}
