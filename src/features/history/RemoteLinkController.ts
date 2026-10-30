import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import type { GitCliRegistry } from '../../core/gitCliRegistry';
import type { GitExtensionService } from '../../core/gitExtensionService';
import { createLogger } from '../../log';
import { branchUrl, commitUrl, fileUrl, repositoryUrl, type LineRange } from '../../shared/history/githubLinks';
import type { GitHubRepository } from '../../shared/history/githubReferences';
import { locateRepoFile } from '../../shared/history/pathHistoryProtocol';
import { githubRepositoryFor } from './githubLinkHost';
import { remoteRef } from './remoteRef';

const log = createLogger('remote-link');

/** Where the work lives on GitHub: open it in the browser, or copy the link to paste into a chat or a review. */
export class RemoteLinkController {
  constructor(
    private readonly gitService: GitExtensionService,
    private readonly cliRegistry: GitCliRegistry,
    private readonly activeRepoRoot: () => string | undefined,
  ) {}

  /** The file of the editor, or the one the Explorer asked about, at the commit or branch GitHub has, with the selected lines. */
  async fileLink(arg?: unknown): Promise<string | undefined> {
    const editor = vscode.window.activeTextEditor;
    const uri = arg instanceof vscode.Uri ? arg : editor?.document.uri;
    if (!uri || uri.scheme !== 'file') {
      return undefined;
    }
    const located = locateRepoFile(this.gitService.getRepositories().map((repo) => repo.rootUri.fsPath), uri.fsPath);
    if (!located || located.path === '.') {
      this.warn(l10n.t('This file is not in a Git repository.'));
      return undefined;
    }
    const cli = this.cliRegistry.getOrCreate(located.repoRoot);
    const tracked = await cli.execRead(['ls-files', '--error-unmatch', '--', located.path], { showErrorToast: false }).then(
      () => true,
      (error: unknown) => {
        // Exit status 1 means the file is not tracked, which is an answer and not a failure.
        log.debug('file is not tracked', error);
        return false;
      },
    );
    if (!tracked) {
      this.warn(l10n.t('This file is not tracked by Git, so GitHub does not have it.'));
      return undefined;
    }
    const repo = await this.repository(located.repoRoot);
    if (!repo) {
      return undefined;
    }
    const lines = editor && editor.document.uri.toString() === uri.toString() ? lineRange(editor.selection) : undefined;
    return fileUrl(repo, await remoteRef(cli), located.path, lines);
  }

  async openFile(arg?: unknown): Promise<void> {
    await this.open(await this.fileLink(arg));
  }

  async copyFileLink(arg?: unknown): Promise<void> {
    await this.copy(await this.fileLink(arg));
  }

  async openCommit(sha: string | undefined): Promise<void> {
    await this.open(await this.commitLink(sha));
  }

  async copyCommitLink(sha: string | undefined): Promise<void> {
    await this.copy(await this.commitLink(sha));
  }

  async openRepository(): Promise<void> {
    const repo = await this.repository(this.activeRepoRoot());
    await this.open(repo ? repositoryUrl(repo) : undefined);
  }

  /** The branch on GitHub, for the graph's branch labels. */
  async openBranch(branch: string): Promise<void> {
    const repo = await this.repository(this.activeRepoRoot());
    await this.open(repo ? branchUrl(repo, branch) : undefined);
  }

  private async commitLink(sha: string | undefined): Promise<string | undefined> {
    const repo = sha ? await this.repository(this.activeRepoRoot()) : undefined;
    return repo && sha ? commitUrl(repo, sha) : undefined;
  }

  private async repository(repoRoot: string | undefined): Promise<GitHubRepository | undefined> {
    if (!repoRoot) {
      this.warn(l10n.t('No Git repository is open.'));
      return undefined;
    }
    const repo = await githubRepositoryFor(repoRoot);
    if (!repo) {
      this.warn(l10n.t('This repository has no GitHub remote.'));
    }
    return repo ?? undefined;
  }

  private async open(url: string | undefined): Promise<void> {
    if (!url) {
      return;
    }
    log.info('open on GitHub');
    if (!(await vscode.env.openExternal(vscode.Uri.parse(url)))) {
      this.warn(l10n.t('Could not open the GitHub link.'));
    }
  }

  private async copy(url: string | undefined): Promise<void> {
    if (!url) {
      return;
    }
    await vscode.env.clipboard.writeText(url);
    void vscode.window.setStatusBarMessage(l10n.t('Copied the GitHub link'), 3000);
  }

  private warn(message: string): void {
    void vscode.window.showWarningMessage(message);
  }
}

/** The lines a selection covers; a selection that ends at the start of a line does not take that line. */
function lineRange(selection: vscode.Selection): LineRange {
  const first = selection.start.line + 1;
  const end = selection.end.character === 0 && selection.end.line > selection.start.line ? selection.end.line : selection.end.line + 1;
  return { first, last: end };
}
