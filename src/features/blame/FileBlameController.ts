import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import type { GitExtensionService } from '../../core/gitExtensionService';
import { createLogger } from '../../log';
import { locateRepoFile } from '../../shared/history/pathHistoryProtocol';
import { fitToWidth, gutterLines, gutterWidth } from './fileBlameLayout';
import { DEFAULT_FILE_BLAME_FORMAT, formatLineBlame } from './lineBlameFormat';
import type { BlameTarget } from './lineBlameHover';
import type { LineBlameService } from './lineBlameService';

const log = createLogger('file-blame');

/** Files this long are left alone: a decoration for each line would cost more than the column shows. */
const MAX_LINES = 20_000;
const EDIT_DELAY_MS = 400;
const FILE_BLAME_CONTEXT = 'gitCheckout.fileBlameActive';

type HoverFor = (target: BlameTarget) => Promise<vscode.MarkdownString | undefined>;

/**
 * Blame for the whole file, in a column at the left of the text: who changed each run of lines and when, with a
 * tint that goes from warm for recent changes to cool for old ones. It is on for the files it was turned on for.
 */
export class FileBlameController implements vscode.Disposable {
  private readonly decoration = vscode.window.createTextEditorDecorationType({});
  private readonly disposables: vscode.Disposable[] = [];
  /** The files whose blame is showing, by address. */
  private readonly on = new Set<string>();
  private timer: NodeJS.Timeout | undefined;
  private generation = 0;
  private shown: { document: vscode.TextDocument; lines: Map<number, BlameTarget> } | undefined;

  constructor(
    private readonly gitService: GitExtensionService,
    private readonly service: LineBlameService,
    private readonly hoverFor: HoverFor,
    onDidRefresh: vscode.Event<{ repoRoot: string }>,
  ) {
    this.disposables.push(
      this.decoration,
      vscode.window.onDidChangeActiveTextEditor(() => this.schedule(0)),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (this.on.has(event.document.uri.toString()) && event.contentChanges.length > 0) {
          // The lines moved, so what is drawn is on the wrong lines until blame catches up.
          this.clear(vscode.window.activeTextEditor);
          this.schedule(EDIT_DELAY_MS);
        }
      }),
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (this.on.has(document.uri.toString())) {
          this.schedule(0);
        }
      }),
      vscode.workspace.onDidCloseTextDocument((document) => this.on.delete(document.uri.toString())),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('gitCheckout.blame') || event.affectsConfiguration('git.blame')) {
          this.schedule(0);
        }
      }),
      onDidRefresh((event) => {
        this.service.invalidate(event.repoRoot);
        this.schedule(0);
      }),
      vscode.languages.registerHoverProvider({ scheme: 'file' }, { provideHover: (document, position) => this.hover(document, position) }),
    );
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.generation++;
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  /** Whether the blame of this file is showing (e2e only). */
  isOn(document: vscode.TextDocument): boolean {
    return this.on.has(document.uri.toString());
  }

  /** What the column shows on each line of the active editor, 1-based (e2e only). */
  columnText(): Map<number, string> | undefined {
    return this.rendered;
  }

  private rendered: Map<number, string> | undefined;

  /** Shows the blame of the file in the active editor, or takes it away. */
  async toggle(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file') {
      return;
    }
    const key = editor.document.uri.toString();
    if (this.on.delete(key)) {
      this.clear(editor);
    } else {
      if (editor.document.lineCount > MAX_LINES) {
        void vscode.window.showInformationMessage(l10n.t('This file is too long to show its blame in the gutter.'));
        return;
      }
      this.on.add(key);
    }
    await this.refresh();
  }

  private schedule(delay: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.refresh().catch((error: unknown) => log.warn('could not show the blame of the file', error));
    }, delay);
  }

  private clear(editor: vscode.TextEditor | undefined): void {
    this.generation++;
    this.shown = undefined;
    this.rendered = undefined;
    editor?.setDecorations(this.decoration, []);
  }

  private async refresh(): Promise<void> {
    const generation = ++this.generation;
    const editor = vscode.window.activeTextEditor;
    const document = editor?.document;
    const active = !!document && this.on.has(document.uri.toString());
    await vscode.commands.executeCommand('setContext', FILE_BLAME_CONTEXT, active);
    if (!editor || !document || !active) {
      this.shown = undefined;
      this.rendered = undefined;
      for (const visible of vscode.window.visibleTextEditors) {
        if (!this.on.has(visible.document.uri.toString())) {
          visible.setDecorations(this.decoration, []);
        }
      }
      return;
    }
    const located = locateRepoFile(this.gitService.getRepositories().map((repo) => repo.rootUri.fsPath), document.uri.fsPath);
    if (!located || located.path === '.') {
      this.clear(editor);
      return;
    }
    const file = await this.service.blameFile(located.repoRoot, located.path, document.isDirty ? document.getText() : undefined);
    if (generation !== this.generation || editor !== vscode.window.activeTextEditor) {
      return;
    }
    if (!file) {
      this.clear(editor);
      return;
    }

    const format = vscode.workspace.getConfiguration('gitCheckout.blame').get<string>('file.format', DEFAULT_FILE_BLAME_FORMAT);
    const now = Date.now();
    const lines = gutterLines(file, document.lineCount, (blame) => formatLineBlame(format, blame, now, vscode.env.language), now);
    const width = gutterWidth(lines);
    const targets = new Map<number, BlameTarget>();
    const rendered = new Map<number, string>();
    const options: vscode.DecorationOptions[] = lines.map((entry) => {
      const blame = file.get(entry.line + 1);
      const text = fitToWidth(entry.text, width);
      rendered.set(entry.line + 1, text);
      if (blame) {
        targets.set(entry.line, { repoRoot: located.repoRoot, sha: blame.sha, path: located.path, line: entry.line + 1, commitPath: blame.path, originalLine: blame.originalLine });
      }
      return {
        range: new vscode.Range(entry.line, 0, entry.line, 0),
        renderOptions: {
          before: {
            contentText: text || '​',
            width: `${width}ch`,
            margin: '0 1.5ch 0 0',
            color: new vscode.ThemeColor('editorCodeLens.foreground'),
            backgroundColor: new vscode.ThemeColor(`gitCheckout.blameHeat${entry.heat}`),
          },
        },
      };
    });
    editor.setDecorations(this.decoration, options);
    this.shown = { document, lines: targets };
    this.rendered = rendered;
  }

  /** Hovering the start of a line in the column gives the commit of that line, as the text at the end of the line does. */
  private async hover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
    const shown = this.shown;
    if (!shown || shown.document !== document || position.character !== 0) {
      return undefined;
    }
    const target = shown.lines.get(position.line);
    if (!target) {
      return undefined;
    }
    const markdown = await this.hoverFor(target);
    return markdown ? new vscode.Hover(markdown) : undefined;
  }
}
