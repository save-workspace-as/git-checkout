/** Parses JSON with comments and trailing commas, as VS Code theme files use. */
export function parseJsonc<T>(text: string): T {
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(stripped) as T;
}
