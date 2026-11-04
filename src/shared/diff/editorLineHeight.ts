/** The editor's own line height for a font size: VS Code uses 1.5 times the size on macOS and 1.35 elsewhere, rounded, at least 8. */
export function editorLineHeight(fontSize: number, mac: boolean): number {
  return Math.max(8, Math.round(fontSize * (mac ? 1.5 : 1.35)));
}
