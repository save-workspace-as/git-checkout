
/** A VS Code codicon, drawn by the `vscode-icon` element. */
export function codicon(name: string): HTMLElement {
  const element = document.createElement('vscode-icon');
  element.setAttribute('name', name);
  element.setAttribute('aria-hidden', 'true');
  return element;
}
