import type { EditorTokenColors } from '../diff/editorTokenColors';

/** One side of a conflict: the branch and the commit it brings. */
export interface MergeSideDto {
  /** A branch name, or a short hash when no branch points at the commit. */
  label: string;
  subject: string;
  author: string;
  /** Commit time, in seconds since the epoch. */
  date: number;
}

export type MergeHostMessage =
  /** Shows the Merge modal for a file, which then asks for it with `mergeReady`. */
  | { type: 'mergeOpen'; path: string }
  /** Hides the Merge modal. */
  | { type: 'mergeClose'; path: string }
  | {
      type: 'mergeInit';
      path: string;
      /** The side Git is bringing in (its "theirs"), shown on the left. */
      incoming: MergeSideDto;
      /** The side checked out (its "ours"), shown on the right. */
      current: MergeSideDto;
      /** The file as Git left it, with conflict markers. */
      text: string;
      /** The whole files of the current side and the incoming side, when Git has both. */
      ours?: string;
      theirs?: string;
    }
  | { type: 'mergeError'; message: string }
  /** The editor theme's token colors, so the code is colored as in the editor. */
  | { type: 'editorTokenColors'; colors: EditorTokenColors };

export type MergeWebviewMessage =
  /** The Merge modal has loaded; `path` is the file it was opened for. */
  | { type: 'mergeReady'; path: string }
  /** Writes the resolved file and stages it, which marks the conflict as resolved. */
  | { type: 'mergeResolve'; path: string; text: string }
  | { type: 'mergeCancel'; path: string }
  | { type: 'mergeOpenInEditor'; path: string };
