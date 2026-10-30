import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import type { GitExtensionService } from '../../core/gitExtensionService';
import { createLogger } from '../../log';
import type { GitCheckoutPanelManager } from '../../panel/gitCheckoutPanelManager';
import { isUncommittedSha } from '../../shared/history/blameProtocol';
import type { GitHubRepository } from '../../shared/history/githubReferences';
import { locateRepoFile } from '../../shared/history/pathHistoryProtocol';
import { githubRepositoryFor, readAutolinks } from '../history/githubLinkHost';
import { DEFAULT_BLAME_FORMAT, formatLineBlame, type LineBlame } from './lineBlameFormat';
import { blameHoverMarkdown, HOVER_COMMANDS, OPEN_COMMIT_COMMAND, roundedAvatar, type BlameTarget } from './lineBlameHover';
import type { LineBlameService } from './lineBlameService';

const log = createLogger('line-blame');

/** Files this long are left alone: blaming them on every keystroke would cost more than it shows. */
const MAX_LINES = 50_000;
const CURSOR_DELAY_MS = 120;
const EDIT_DELAY_MS = 400;
/** Pictures are drawn 32 points wide; twice that keeps them sharp on a dense screen. */
const AVATAR_PIXELS = 64;
const MAX_AVATAR_BYTES = 200_000;

type Host = Pick<GitCheckoutPanelManager, 'selectRepository' | 'showCommitChange' | 'revealRefInGraph' | 'pathHistoryPanel' | 'graphService'>;

interface Shown {
  document: vscode.TextDocument;
  line: number;
  target: BlameTarget;
  blame: LineBlame;
}

/**
 * Blame for the line the cursor is on: faint text at its end, the same in the status bar, and a hover on that
 * text with the commit, its linked issues and pull requests, and actions.
 */
export class LineBlameController implements vscode.Disposable {
  private readonly decoration = vscode.window.createTextEditorDecorationType({});
  private readonly statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  private readonly disposables: vscode.Disposable[] = [];
  private readonly repositories = new Map<string, Promise<GitHubRepository | null>>();
  private readonly pictures = new Map<string, string>();
  private shown: Shown | undefined;
  private timer: NodeJS.Timeout | undefined;
  private generation = 0;

  constructor(
    private readonly gitService: GitExtensionService,
    private readonly service: LineBlameService,
    private readonly host: Host,
    onDidRefresh: vscode.Event<{ repoRoot: string }>,
  ) {
    this.statusItem.name = l10n.t('Git Checkout: Blame');
    this.disposables.push(
      this.decoration,
      this.statusItem,
      vscode.window.onDidChangeActiveTextEditor(() => this.schedule(0)),
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor === vscode.window.activeTextEditor) {
          this.schedule(CURSOR_DELAY_MS);
        }
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document === vscode.window.activeTextEditor?.document && event.contentChanges.length > 0) {
          // The text moved, so what is shown may sit on the wrong line until blame catches up.
          this.clear();
          this.schedule(EDIT_DELAY_MS);
        }
      }),
      vscode.workspace.onDidSaveTextDocument(() => this.schedule(0)),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('gitCheckout.blame') || event.affectsConfiguration('git.blame')) {
          this.schedule(0);
        }
      }),
      onDidRefresh((event) => {
        this.service.invalidate(event.repoRoot);
        this.repositories.delete(event.repoRoot);
        this.schedule(0);
      }),
      vscode.languages.registerHoverProvider({ scheme: 'file' }, { provideHover: (document, position) => this.hover(document, position) }),
    );
    this.schedule(0);
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.generation++;
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  /** What blame says about the line the cursor is on (e2e only). */
  currentLine(): { sha: string; text: string } | undefined {
    return this.shown ? { sha: this.shown.blame.sha, text: this.text(this.shown.blame) } : undefined;
  }

  /** Makes the text at the end of the line appear or go away, for every window. */
  async toggleInline(): Promise<void> {
    const config = vscode.workspace.getConfiguration('gitCheckout.blame.inline');
    await config.update('enabled', !config.get<boolean>('enabled', true), vscode.ConfigurationTarget.Global);
  }

  async copyHash(arg?: unknown): Promise<void> {
    const target = this.targetOf(arg);
    if (!target) {
      return;
    }
    await vscode.env.clipboard.writeText(target.sha);
    void vscode.window.setStatusBarMessage(l10n.t('Copied {0}', target.sha.slice(0, 7)), 3000);
  }

  /** Shows the commit in the commit graph. */
  async openCommit(arg?: unknown): Promise<void> {
    const target = this.targetOf(arg);
    if (!target) {
      return;
    }
    await this.host.selectRepository(target.repoRoot);
    await this.host.revealRefInGraph(target.sha);
  }

  /** The change the commit made to the file, in the Commit tab beside the graph. */
  async openChanges(arg?: unknown): Promise<void> {
    const target = this.targetOf(arg);
    if (!target) {
      return;
    }
    await this.host.selectRepository(target.repoRoot);
    await this.host.showCommitChange(target.sha, target.commitPath ?? target.path);
  }

  /** The Blame modal for the file, with the commit of the line selected. */
  async openInBlame(arg?: unknown): Promise<void> {
    const target = this.targetOf(arg);
    if (!target) {
      return;
    }
    await this.host.selectRepository(target.repoRoot);
    await this.host.pathHistoryPanel().showBlameAt(target.repoRoot, target.path, target.sha);
  }

  /** The Blame modal at the commit that changed the line before the line's own commit did. */
  async blameBefore(arg?: unknown): Promise<void> {
    const target = this.targetOf(arg);
    if (!target) {
      return;
    }
    await this.host.selectRepository(target.repoRoot);
    await this.host.pathHistoryPanel().showBlameBefore(target.repoRoot, target.path, target.sha, target.commitPath ?? target.path, target.originalLine ?? target.line);
  }

  /** The history of the line, as the history modal shows it for a hunk. */
  async lineHistory(arg?: unknown): Promise<void> {
    const target = this.targetOf(arg);
    if (!target) {
      return;
    }
    await this.host.selectRepository(target.repoRoot);
    await this.host.pathHistoryPanel().showHunk({ webviewSection: 'hunk', path: target.path, startLine: target.line, endLine: target.line });
  }

  private targetOf(arg?: unknown): BlameTarget | undefined {
    const given = arg as Partial<BlameTarget> | undefined;
    if (given && typeof given.repoRoot === 'string' && typeof given.sha === 'string' && typeof given.path === 'string' && typeof given.line === 'number') {
      const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
      return { repoRoot: given.repoRoot, sha: given.sha, path: given.path, line: given.line, commitPath: text(given.commitPath), originalLine: typeof given.originalLine === 'number' ? given.originalLine : undefined };
    }
    if (!this.shown || isUncommittedSha(this.shown.blame.sha)) {
      void vscode.window.showInformationMessage(l10n.t('The line has no commit yet.'));
      return undefined;
    }
    return this.shown.target;
  }

  private schedule(delay: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.refresh().catch((error: unknown) => log.warn('could not show blame', error));
    }, delay);
  }

  private setting<T>(key: string, fallback: T): T {
    return vscode.workspace.getConfiguration('gitCheckout.blame').get<T>(key, fallback);
  }

  private text(blame: LineBlame): string {
    return formatLineBlame(this.setting<string>('inline.format', DEFAULT_BLAME_FORMAT), blame, Date.now());
  }

  private clear(): void {
    this.generation++;
    this.shown = undefined;
    this.statusItem.hide();
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(this.decoration, []);
    }
  }

  private async refresh(): Promise<void> {
    const generation = ++this.generation;
    const editor = vscode.window.activeTextEditor;
    // VS Code's own Git extension can show the same two things; showing both would say everything twice.
    const builtIn = vscode.workspace.getConfiguration('git');
    const inline = this.setting('inline.enabled', true) && !builtIn.get<boolean>('blame.editorDecoration.enabled', false);
    const statusBar = this.setting('statusBar.enabled', true) && !builtIn.get<boolean>('blame.statusBarItem.enabled', false);
    const document = editor?.document;
    const located =
      document?.uri.scheme === 'file' && document.lineCount <= MAX_LINES
        ? locateRepoFile(this.gitService.getRepositories().map((repo) => repo.rootUri.fsPath), document.uri.fsPath)
        : undefined;
    if (!editor || !document || !located || located.path === '.' || (!inline && !statusBar)) {
      this.clear();
      return;
    }

    const line = editor.selection.active.line;
    const file = await this.service.blameFile(located.repoRoot, located.path, document.isDirty ? document.getText() : undefined);
    const blame = file?.get(line + 1);
    if (generation !== this.generation || editor !== vscode.window.activeTextEditor) {
      return;
    }
    if (!blame) {
      this.clear();
      return;
    }

    const text = this.text(blame);
    this.shown = { document, line, blame, target: { repoRoot: located.repoRoot, sha: blame.sha, path: located.path, line: line + 1, commitPath: blame.path, originalLine: blame.originalLine } };
    const end = document.lineAt(Math.min(line, document.lineCount - 1)).range.end;
    editor.setDecorations(
      this.decoration,
      inline
        ? [{ range: new vscode.Range(end, end), renderOptions: { after: { contentText: text, color: new vscode.ThemeColor('editorCodeLens.foreground'), margin: '0 0 0 3em' } } }]
        : [],
    );
    if (statusBar) {
      this.statusItem.text = `$(git-commit) ${text}`;
      this.statusItem.command = isUncommittedSha(blame.sha) ? undefined : { command: OPEN_COMMIT_COMMAND, title: l10n.t('Show Commit in Graph') };
      this.statusItem.tooltip = await this.hoverMarkdown(this.shown.target);
      if (generation !== this.generation) {
        return;
      }
      this.statusItem.show();
    } else {
      this.statusItem.hide();
    }
  }

  private async hover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
    const shown = this.shown;
    // By default the hover belongs to the text at the end of the cursor's line, not to the code before it.
    const over = this.setting<string>('hover.over', 'annotation');
    if (!shown || shown.document !== document || position.line !== shown.line || (over !== 'line' && position.character < document.lineAt(position.line).text.length)) {
      return undefined;
    }
    const markdown = await this.hoverMarkdown(shown.target);
    return markdown ? new vscode.Hover(markdown) : undefined;
  }

  /** The author's GitHub picture, when the graph's setting for pictures is on and the repository is on GitHub. */
  private async avatarOf(github: GitHubRepository | null, commit: { sha: string; authorMail: string }): Promise<string | undefined> {
    const avatars = this.host.graphService.githubAvatars;
    if (!github || !avatars || !vscode.workspace.getConfiguration('gitCheckout.graph').get<boolean>('githubAvatars', true)) {
      return undefined;
    }
    try {
      // `lookUp` returns only the pictures it just found; one found before is in `known`.
      await avatars.lookUp(github, [{ sha: commit.sha, authorEmail: commit.authorMail }]);
      const url = avatars.known(commit.authorMail);
      return url ? await this.pictureOf(url) : undefined;
    } catch (error) {
      log.debug('no GitHub picture for the author', error);
      return undefined;
    }
  }

  /** The picture at `url` as a circle, fetched once per address. */
  private async pictureOf(url: string): Promise<string | undefined> {
    const known = this.pictures.get(url);
    if (known !== undefined) {
      return known || undefined;
    }
    let picture = '';
    try {
      const address = new URL(url);
      if (address.protocol === 'https:') {
        address.searchParams.set('s', String(AVATAR_PIXELS));
        const response = await fetch(address, { signal: AbortSignal.timeout(4000) });
        const bytes = new Uint8Array(await response.arrayBuffer());
        // A picture that cannot be cut to a circle is shown square from its own address.
        picture = response.ok && bytes.length <= MAX_AVATAR_BYTES ? roundedAvatar(bytes, response.headers.get('content-type')?.split(';')[0] ?? '') ?? url : '';
      }
    } catch (error) {
      log.debug('could not load the author picture', error);
    }
    this.pictures.set(url, picture);
    return picture || undefined;
  }

  /** The hover for the commit of one line: who and when, the message with its links, and the actions. */
  async hoverMarkdown(target: BlameTarget): Promise<vscode.MarkdownString | undefined> {
    const { repoRoot, sha } = target;
    const commit = isUncommittedSha(sha) ? { sha, author: '', authorMail: '', authorTime: 0, message: '' } : await this.service.commit(repoRoot, sha);
    if (!commit) {
      return undefined;
    }
    let repository = this.repositories.get(repoRoot);
    if (!repository) {
      repository = githubRepositoryFor(repoRoot);
      this.repositories.set(repoRoot, repository);
    }
    const github = await repository;
    const markdown = new vscode.MarkdownString(
      blameHoverMarkdown(commit, target, github, Date.now(), vscode.env.language, await this.avatarOf(github, commit), readAutolinks()),
      true,
    );
    markdown.isTrusted = { enabledCommands: HOVER_COMMANDS };
    return markdown;
  }
}
