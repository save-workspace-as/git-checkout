import * as path from 'node:path';

/** The path a save dialog starts at: the folder of the last save, else `fallbackFolder`, with `fileName` in it. */
export function saveStartPath(fileName: string, lastFolder: string | undefined, fallbackFolder?: string): string {
  const folder = lastFolder || fallbackFolder;
  return folder ? path.join(folder, fileName) : fileName;
}
