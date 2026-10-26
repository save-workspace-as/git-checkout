import { createLogger } from '../../log';

const log = createLogger('mergeEditor');

export type MergeEditorCommandRunner = (command: string, ...args: unknown[]) => Thenable<unknown>;

const MERGE_EDITOR_COMMANDS = ['git.openMergeEditor', 'merge.openEditor'];

export interface MergeEditorUri {
  fsPath: string;
}

export async function openFileInMergeEditor(
  fileUri: MergeEditorUri,
  runCommand: MergeEditorCommandRunner,
): Promise<boolean> {
  for (const command of MERGE_EDITOR_COMMANDS) {
    try {
      await runCommand(command, fileUri);
      return true;
    } catch (error) {
      log.debug(`merge editor command ${command} failed`, error);
    }
  }
  return false;
}
