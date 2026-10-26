const NAME_ORDER = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Folders before files, then names in natural order. */
export function compareTreeEntries(
  left: { name: string; folder: boolean },
  right: { name: string; folder: boolean },
): number {
  if (left.folder !== right.folder) {
    return left.folder ? -1 : 1;
  }
  return NAME_ORDER.compare(left.name, right.name) || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
}
