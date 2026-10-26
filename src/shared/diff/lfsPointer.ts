import * as l10n from '@vscode/l10n';

export interface LfsPointerFields {
  oid: string;
  size: number;
}

const LFS_VERSION_PREFIX = 'version https://git-lfs.github.com/spec/v1';

export function isLfsPointerText(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith(LFS_VERSION_PREFIX);
}

export function parseLfsPointer(text: string): LfsPointerFields | null {
  if (!isLfsPointerText(text)) {
    return null;
  }
  let oid: string | undefined;
  let size: number | undefined;
  for (const line of text.split(/\r?\n/)) {
    const oidMatch = /^oid sha256:([0-9a-f]{64})$/i.exec(line.trim());
    if (oidMatch) {
      oid = oidMatch[1].toLowerCase();
      continue;
    }
    const sizeMatch = /^size (\d+)$/.exec(line.trim());
    if (sizeMatch) {
      size = Number(sizeMatch[1]);
    }
  }
  if (!oid || size === undefined || !Number.isFinite(size)) {
    return null;
  }
  return { oid, size };
}

export function formatLfsPointerLabel(pointer: LfsPointerFields | undefined): string {
  if (!pointer) {
    return l10n.t('(missing)');
  }
  return l10n.t('oid {0}… · {1} bytes', pointer.oid.slice(0, 12), pointer.size);
}

export function describePointerVersusContent(
  stored: LfsPointerFields | null,
  contentPresent: boolean,
): string {
  if (!stored) {
    return l10n.t('Git does not store a Git LFS pointer for this file.');
  }
  const label = formatLfsPointerLabel(stored);
  if (contentPresent) {
    return l10n.t('Working tree has file content. Git stores a pointer ({0}).', label);
  }
  return l10n.t('Working tree still holds the pointer ({0}).', label);
}
