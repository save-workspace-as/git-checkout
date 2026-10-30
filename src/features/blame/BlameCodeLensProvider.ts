import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import type { GitExtensionService } from '../../core/gitExtensionService';
import { createLogger } from '../../log';
import { isUncommittedSha } from '../../shared/history/blameProtocol';
import { locateRepoFile } from '../../shared/history/pathHistoryProtocol';
import { summarizeRange } from './fileBlameLayout';
import { relativeAge } from './lineBlameFormat';
import { OPEN_COMMIT_COMMAND, type BlameTarget } from './lineBlameHover';
import type { LineBlameService } from './lineBlameService';

const log = createLogger('blame-codelens');

/** The kinds of symbol that get their own lenses: the ones that hold code worth asking about. */
const LENS_KINDS = new Set<vscode.SymbolKind>([
  vscode.SymbolKind.Class,
  vscode.SymbolKind.Interface,
  vscode.SymbolKind.Enum,
  vscode.SymbolKind.Struct,
  vscode.SymbolKind.Module,
  vscode.SymbolKind.Namespace,
  vscode.SymbolKind.Function,
  vscode.SymbolKind.Method,
  vscode.SymbolKind.Constructor,
]);
const MAX_LINES = 20_000;
const MAX_LENSES = 300;
export const TOGGLE_FILE_BLAME_COMMAND = 'gitCheckout.blame.toggleFile';

/**
 * Above a file and each of its classes and functions: who changed it last and when, and how many people have
 * written it. The first opens that commit in the graph; the second shows the file's blame in the gutter.
 */
export class BlameCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;

  constructor(
    private readonly gitService: GitExtensionService,
    private readonly service: LineBlameService,
  ) {}

  dispose(): void {
    this.changed.dispose();
  }

  /** Asks VS Code for the lenses again, after the settings or the history changed. */
  refresh(): void {
    this.changed.fire();
  }

  async provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {
    if (!vscode.workspace.getConfiguration('gitCheckout.codeLens').get<boolean>('enabled', false) || document.uri.scheme !== 'file' || document.lineCount > MAX_LINES) {
      return [];
    }
    const located = locateRepoFile(this.gitService.getRepositories().map((repo) => repo.rootUri.fsPath), document.uri.fsPath);
    if (!located || located.path === '.') {
      return [];
    }
    const file = await this.service.blameFile(located.repoRoot, located.path, document.isDirty ? document.getText() : undefined);
    if (!file || token.isCancellationRequested) {
      return [];
    }
    const ranges = [new vscode.Range(0, 0, Math.max(0, document.lineCount - 1), 0), ...(await this.symbolRanges(document))];
    const lenses: vscode.CodeLens[] = [];
    const seen = new Set<number>();
    const now = Date.now();
    for (const range of ranges) {
      if (seen.has(range.start.line)) {
        continue;
      }
      seen.add(range.start.line);
      const summary = summarizeRange(file, range.start.line + 1, range.end.line + 1);
      const { recent } = summary;
      if (!recent) {
        continue;
      }
      const at = new vscode.Range(range.start.line, 0, range.start.line, 0);
      const uncommitted = isUncommittedSha(recent.sha);
      const target: BlameTarget = { repoRoot: located.repoRoot, sha: recent.sha, path: located.path, line: range.start.line + 1, commitPath: recent.path };
      lenses.push(
        new vscode.CodeLens(at, {
          title: uncommitted ? l10n.t('You, uncommitted changes') : `${recent.author}, ${relativeAge(recent.authorTime, now, vscode.env.language)}`,
          tooltip: uncommitted ? undefined : recent.summary,
          command: uncommitted ? '' : OPEN_COMMIT_COMMAND,
          arguments: uncommitted ? undefined : [target],
        }),
      );
      if (summary.authors.length > 1) {
        const [top] = summary.authors;
        lenses.push(
          new vscode.CodeLens(at, {
            title: l10n.t('{0} authors ({1} +{2})', summary.authors.length, top.name, summary.authors.length - 1),
            tooltip: summary.authors.map((author) => `${author.name}: ${author.lines}`).join('\n'),
            command: TOGGLE_FILE_BLAME_COMMAND,
          }),
        );
      }
      if (lenses.length >= MAX_LENSES) {
        break;
      }
    }
    return lenses;
  }

  private async symbolRanges(document: vscode.TextDocument): Promise<vscode.Range[]> {
    try {
      const symbols = await vscode.commands.executeCommand<(vscode.DocumentSymbol | vscode.SymbolInformation)[] | undefined>(
        'vscode.executeDocumentSymbolProvider',
        document.uri,
      );
      const ranges: vscode.Range[] = [];
      const visit = (list: readonly (vscode.DocumentSymbol | vscode.SymbolInformation)[]): void => {
        for (const symbol of list) {
          if (LENS_KINDS.has(symbol.kind)) {
            ranges.push('range' in symbol ? symbol.range : symbol.location.range);
          }
          if ('children' in symbol) {
            visit(symbol.children);
          }
        }
      };
      visit(symbols ?? []);
      return ranges.sort((a, b) => a.start.line - b.start.line);
    } catch (error) {
      // A language with no symbol provider still gets the lens for the whole file.
      log.debug('no symbols for the file', error);
      return [];
    }
  }
}
