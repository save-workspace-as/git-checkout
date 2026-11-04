/**
 * Marks a webview's `<body>` when the person turned the AI features off, so the styles can hide the buttons that use a
 * language model (the ones with the `ai-action` class). Nothing is written while they are on.
 */
export function aiBodyAttribute(enabled: boolean): string {
  return enabled ? '' : ' data-ai="off"';
}
