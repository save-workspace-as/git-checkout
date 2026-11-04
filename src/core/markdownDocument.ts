import * as vscode from 'vscode';

/** Opens `content` as a Markdown document beside the active editor, as the place to read what an AI feature wrote. */
export async function showMarkdownBeside(content: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument({ language: 'markdown', content });
  await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside, preview: true });
}
