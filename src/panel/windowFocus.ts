import * as vscode from 'vscode';
import { Activity } from '../core/whenActive';

let pretended: boolean | undefined;

/** Whether this window is the one in front. A window in the background keeps nothing on screen up to date. */
export const windowFocus = new Activity(() => pretended ?? vscode.window.state.focused);

/** Tells whoever waits for the window to come back to the front. */
export function trackWindowFocus(): vscode.Disposable {
  return vscode.window.onDidChangeWindowState(() => windowFocus.changed());
}

/** Says the window is in front or not whatever it is, for tests that cannot bring one forward; `undefined` goes back to the truth. */
export function pretendWindowFocused(focused: boolean | undefined): void {
  pretended = focused;
  windowFocus.changed();
}
