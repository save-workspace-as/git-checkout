import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { buildChangeGroup, changeKey, type ChangeNode } from '../../shared/changes/changesTree';
import { gitNameStatusHighlight, workingCopyStatusHighlight, workingCopyStatusLetter } from '../../shared/changes/gitFileStatus';
import type { WorkingCopyDiffSide, WorkingCopyEntryDto } from '../../shared/changes/workingCopyProtocol';
import { NativeFileList, ScopedFileList } from '../../panel/nativeFileList';
import type { RevisionList } from '../history/revisionLists';

/** URIs of changes carry their status, so the file decoration provider can badge and color them. */
export const CHANGE_URI_SCHEME = 'git-checkout-change';

const DECORATION_COLORS: Record<string, string> = {
  added: 'gitDecoration.addedResourceForeground',
  modified: 'gitDecoration.modifiedResourceForeground',
  deleted: 'gitDecoration.deletedResourceForeground',
  renamed: 'gitDecoration.renamedResourceForeground',
  untracked: 'gitDecoration.untrackedResourceForeground',
  conflict: 'gitDecoration.conflictingResourceForeground',
  neutral: 'gitDecoration.ignoredResourceForeground',
};

/** A URI for a row; with a status it gets a badge and color, without one it is a plain folder. */
export function changeUri(path: string, status?: { letter: string; highlight: string; label: string }): vscode.Uri {
  const query = status
    ? new URLSearchParams({ letter: status.letter, highlight: status.highlight, status: status.label }).toString()
    : '';
  return vscode.Uri.from({ scheme: CHANGE_URI_SCHEME, path: `/${path.replace(/\/+$/, '')}`, query });
}

/** The status letter and color VS Code draws after a file's name, like the Source Control view does. */
export class ChangeDecorations implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<undefined>();
  readonly onDidChangeFileDecorations = this.changed.event;
  private readonly registration = vscode.window.registerFileDecorationProvider(this);

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== CHANGE_URI_SCHEME || !uri.query) {
      return undefined;
    }
    const params = new URLSearchParams(uri.query);
    const letter = params.get('letter');
    if (!letter) {
      return undefined;
    }
    const highlight = params.get('highlight') ?? 'neutral';
    return new vscode.FileDecoration(
      letter,
      l10n.t('Git status: {0}', params.get('status') ?? letter),
      new vscode.ThemeColor(DECORATION_COLORS[highlight] ?? DECORATION_COLORS.neutral),
    );
  }

  refresh(): void {
    this.changed.fire(undefined);
  }

  dispose(): void {
    this.registration.dispose();
    this.changed.dispose();
  }
}

/** The status of a change in a working copy list, as the decoration and tooltip show it. */
export function workingCopyUriStatus(status: WorkingCopyEntryDto['status']) {
  return { letter: workingCopyStatusLetter(status), highlight: workingCopyStatusHighlight(status), label: status };
}

/** The status of a file in a commit, from its `git diff-tree --name-status` token. */
export function commitUriStatus(status: string) {
  return { letter: status.charAt(0).toUpperCase(), highlight: gitNameStatusHighlight(status), label: status };
}

export interface ChangesListContent {
  /** What is staged, and what is not. */
  staged: readonly WorkingCopyEntryDto[];
  unstaged: readonly WorkingCopyEntryDto[];
  /** Folders, rather than a flat list. */
  tree: boolean;
}

/** The Changes list: a Staged group, when something is staged, and an Unstaged group, each collapsible. */
export class ChangesList extends NativeFileList<ChangeNode> {
  constructor(
    viewId: string,
    private readonly decorations: ChangeDecorations,
    onPick: (change: { path: string; side: WorkingCopyDiffSide }) => void,
  ) {
    super(viewId, {
      item: (node) => {
        const item = new vscode.TreeItem(
          node.label,
          node.kind === 'dir' ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
        );
        item.id = node.key;
        if (node.kind === 'dir' && node.group) {
          // The count, like the badge on a group of the Source Control view.
          item.contextValue = `change.group.${node.side}`;
          item.description = String(node.files.length);
          return item;
        }
        // A conflicted file also offers to be resolved by keeping one side.
        item.contextValue = `change.${node.kind}.${node.side}${node.kind === 'file' && node.status === 'conflict' ? '.conflict' : ''}`;
        if (node.kind === 'file') {
          item.resourceUri = changeUri(node.path, workingCopyUriStatus(node.status));
          item.description = node.folder || undefined;
          item.tooltip = node.originalPath ? `${node.originalPath} → ${node.path}` : node.path;
        } else {
          item.resourceUri = changeUri(node.path);
        }
        return item;
      },
      onPick: (node) => {
        if (node.kind === 'file') {
          onPick({ path: node.path, side: node.side });
        }
      },
    });
  }

  /** Replaces the changes the list shows. */
  showChanges(content: ChangesListContent): void {
    const groups = [
      ...(content.staged.length > 0 ? [buildChangeGroup('staged', l10n.t('Staged'), content.staged, content.tree)] : []),
      buildChangeGroup('unstaged', l10n.t('Unstaged'), content.unstaged, content.tree),
    ];
    this.show(groups);
    this.decorations.refresh();
  }

  selectChange(change: { path: string; side: WorkingCopyDiffSide } | null): void {
    this.select(change ? changeKey(change.side, change.path) : null);
  }
}

/** The native lists of the sidebar. */
export interface PanelLists {
  changes: ChangesList;
  commitFiles: RevisionList;
  tree: RevisionList;
}

/** A window's handle on a shared Changes list. */
export class ScopedChangesList {
  private readonly scoped: ScopedFileList<ChangeNode>;
  constructor(
    private readonly list: ChangesList,
    private readonly owns: () => boolean,
  ) {
    this.scoped = new ScopedFileList(list, owns);
  }

  show(content: ChangesListContent): void {
    if (this.owns()) {
      this.list.showChanges(content);
    }
  }

  select(change: { path: string; side: WorkingCopyDiffSide } | null): void {
    if (this.owns()) {
      this.list.selectChange(change);
    }
  }

  get view(): vscode.TreeView<ChangeNode> | undefined {
    return this.scoped.view;
  }
}
