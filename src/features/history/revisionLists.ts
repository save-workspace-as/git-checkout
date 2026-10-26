import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { buildRevisionNodes, revisionFileKey, type RevisionFile, type RevisionListOptions, type RevisionNode } from '../../shared/history/revisionTree';
import { changeUri, commitUriStatus, type ChangeDecorations } from '../changes/changesList';
import { NativeFileList, ScopedFileList } from '../../panel/nativeFileList';

/**
 * A commit's changed files, or the files of a revision, as a native tree view. A row is also the context
 * the file commands run on (the same fields the webview rows put in `data-vscode-context`).
 */
export class RevisionList extends NativeFileList<RevisionNode> {
  constructor(
    viewId: string,
    private readonly decorations: ChangeDecorations,
    folderState: vscode.TreeItemCollapsibleState,
    onPick: (node: RevisionNode) => void,
  ) {
    super(viewId, {
      item: (node) => {
        const item = new vscode.TreeItem(
          node.label,
          node.kind === 'dir' ? folderState : vscode.TreeItemCollapsibleState.None,
        );
        item.id = node.key;
        item.contextValue = node.kind === 'dir' ? 'rev.dir' : 'rev.file';
        if (node.kind === 'file') {
          item.resourceUri = changeUri(node.path, node.status ? commitUriStatus(node.status) : undefined);
          item.description = node.folder || undefined;
          item.tooltip = node.oldPath ? `${node.oldPath} → ${node.path}` : node.path;
        } else {
          item.resourceUri = changeUri(node.path);
        }
        return item;
      },
      onPick,
    });
  }

  showFiles(files: readonly RevisionFile[], options: RevisionListOptions, emptyMessage?: string): void {
    this.show(buildRevisionNodes(files, options), emptyMessage);
    this.decorations.refresh();
  }

  selectPath(path: string | null): void {
    this.select(path ? revisionFileKey(path) : null);
  }
}

export const EMPTY_COMMIT_FILES = (): string => l10n.t('No changed files.');
export const EMPTY_TREE = (): string => l10n.t('No files at this revision.');

/** A window's handle on a shared revision list. */
export class ScopedRevisionList {
  private readonly scoped: ScopedFileList<RevisionNode>;
  constructor(
    private readonly list: RevisionList,
    private readonly owns: () => boolean,
  ) {
    this.scoped = new ScopedFileList(list, owns);
  }

  show(files: readonly RevisionFile[], options: RevisionListOptions, emptyMessage?: string): void {
    if (this.owns()) {
      this.list.showFiles(files, options, emptyMessage);
    }
  }

  selectPath(path: string | null): void {
    if (this.owns()) {
      this.list.selectPath(path);
    }
  }

  get view(): vscode.TreeView<RevisionNode> | undefined {
    return this.scoped.view;
  }
}
