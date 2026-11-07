import * as path from 'node:path';
import * as vscode from 'vscode';
import { saveStartPath } from './saveStartPath';

const LAST_SAVE_FOLDER_KEY = 'gitCheckout.lastSaveFolder';

let remembered: vscode.Memento | undefined;

/** Where the last save folder is kept between sessions; set once on activation. */
export function rememberSaveFolderIn(state: vscode.Memento): void {
  remembered = state;
}

/** The location to open a save dialog at for `fileName`. */
export function saveDialogStart(fileName: string, fallbackFolder?: string): vscode.Uri {
  return vscode.Uri.file(saveStartPath(fileName, remembered?.get<string>(LAST_SAVE_FOLDER_KEY), fallbackFolder ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath));
}

/** The folder an open dialog starts at: `current` when the field has one, else the last folder used, else `fallbackFolder`. */
export function openDialogStart(current: string | undefined, fallbackFolder?: string): vscode.Uri | undefined {
  const folder = current || remembered?.get<string>(LAST_SAVE_FOLDER_KEY) || fallbackFolder;
  return folder ? vscode.Uri.file(folder) : undefined;
}

/** Keeps the folder a person picked in an open dialog (the folder itself, or the one holding the file). */
export function rememberOpenedFolder(picked: vscode.Uri | undefined, isFolder: boolean): void {
  if (picked?.scheme === 'file') {
    void remembered?.update(LAST_SAVE_FOLDER_KEY, isFolder ? picked.fsPath : path.dirname(picked.fsPath));
  }
}

/** Keeps the folder of a file the person chose to save, for the next save dialog. */
export function rememberSavedFolder(saved: vscode.Uri): void {
  if (saved.scheme === 'file') {
    void remembered?.update(LAST_SAVE_FOLDER_KEY, path.dirname(saved.fsPath));
  }
}
