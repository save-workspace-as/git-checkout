import * as vscode from 'vscode';
import { createLogger } from '../log';

const log = createLogger('scm-visibility');

const SCM_VIEW_IDS = ['workbench.scm', 'workbench.view.scm', 'scm'];

let hideApplied = false;

export async function hideBuiltInScm(): Promise<void> {
  hideApplied = true;
  for (const id of SCM_VIEW_IDS) {
    try {
      await vscode.commands.executeCommand('workbench.action.closeView', id);
    } catch (error) {
      log.debug(`could not close built-in SCM view ${id}`, error);
    }
  }
}

export async function restoreBuiltInScm(): Promise<void> {
  if (!hideApplied) {
    return;
  }
  hideApplied = false;
  try {
    await vscode.commands.executeCommand('workbench.view.scm');
  } catch (error) {
    log.debug('could not restore the built-in SCM view', error);
  }
}
