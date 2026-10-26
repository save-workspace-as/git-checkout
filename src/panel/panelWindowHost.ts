import type { BottomViewSlots } from './bottomPanelViews';
import type { PanelLists } from '../features/changes/changesList';

/**
 * What one repository window shares with the others: the bottom views, which show whichever window
 * is current, and the sidebar and commands, which act on it.
 */
export interface PanelWindowHost {
  readonly slots: BottomViewSlots;
  /** The file lists of the bottom panels, which are native tree views. */
  readonly lists: PanelLists;
  /** Whether `window` is the current one. */
  owns(window: object): boolean;
  /** `window`'s panel was opened or came to the front: it becomes the current one. */
  focused(window: object): void;
  /** `window`'s panel was closed. */
  panelClosed(window: object): void;
}
