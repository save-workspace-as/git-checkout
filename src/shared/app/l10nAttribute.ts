/**
 * The translations for a webview, as the value of a `data-l10n` attribute on its `<body>`. A webview
 * cannot reach `vscode.l10n`, so the extension hands it the bundle VS Code loaded for the display
 * language. English has no bundle: the attribute is left out and the source strings are shown.
 */
export function l10nBodyAttribute(bundle: Record<string, string> | undefined): string {
  if (!bundle || Object.keys(bundle).length === 0) {
    return '';
  }
  const json = JSON.stringify(bundle)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return ` data-l10n="${json}"`;
}

/** Reads what `l10nBodyAttribute` wrote; anything else is no translations. */
export function parseL10nAttribute(value: string | undefined): Record<string, string> | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }
    const contents: Record<string, string> = {};
    for (const [key, text] of Object.entries(parsed)) {
      if (typeof text === 'string') {
        contents[key] = text;
      }
    }
    return contents;
  } catch {
    // A bundle that does not parse leaves the webview in English; there is nothing to report from here.
    return undefined;
  }
}
