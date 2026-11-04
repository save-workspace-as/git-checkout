import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { createLogger } from '../../log';
import { buildConflictPrompt, buildWholeFilePrompt, fitsConflictPrompt, isBinaryText, isDeleteAnswer, parseResolvedFile } from '../../shared/conflicts/conflictPrompt';
import { conflictsOf, parseMergeDocument } from '../../shared/conflicts/mergeDocument';
import type { MergeHostMessage, MergeWebviewMessage } from '../../shared/conflicts/mergeProtocol';
import type { GitCheckoutPanelManager } from '../../panel/gitCheckoutPanelManager';
import { readActiveEditorTokenColors } from '../../panel/activeEditorTheme';
import { editorTokenColorsFromRules } from '../../shared/diff/editorTokenColors';
import { askLanguageModel, NoLanguageModelError, type ConflictModel } from './conflictModel';
import type { MergeResolverFile } from './mergeResolverService';
import { MergeResolverService } from './mergeResolverService';

const log = createLogger('merge-resolver');

/** What MergeResolverController needs from the window that owns it. */
export type MergeResolverContext = Pick<
  GitCheckoutPanelManager,
  '_onDidChangeRefs' | 'activeRepoRoot' | 'changes' | 'cliRegistry' | 'createOrReveal' | 'postState' | 'postWhenReady'
>;

/** The Merge modal: one conflicted file, with the two sides to choose from and the result below. */
export class MergeResolverController {
  private resolver: MergeResolverService | undefined;
  private opened: string | undefined;
  private model: ConflictModel = askLanguageModel;

  constructor(private readonly ctx: MergeResolverContext) {}

  /** Replaces the language model, or puts VS Code's back (e2e only: the tests have no model to ask). */
  useModel(model: ConflictModel | undefined): void {
    this.model = model ?? askLanguageModel;
  }

  /** Made on first use: the window sets up its Git CLIs after it has built its controllers. */
  private get service(): MergeResolverService {
    this.resolver ??= new MergeResolverService(this.ctx.cliRegistry);
    return this.resolver;
  }

  /** The conflicted file and who conflicts, for the Changes tab; it can be merged here when it has markers left. */
  async describe(repoRoot: string, path: string): Promise<(MergeResolverFile & { canMerge: boolean }) | undefined> {
    try {
      const file = await this.service.load(repoRoot, path);
      return { ...file, canMerge: conflictsOf(parseMergeDocument(file.text)).length > 0 };
    } catch (error) {
      // A file one side deleted has nothing on disk to merge; the merge editor explains what is left to do.
      log.debug(`${path} cannot be merged here`, error);
      return undefined;
    }
  }

  /** Shows the Merge modal for a file in the Git Checkout window. */
  open(path: string): void {
    this.opened = path;
    this.ctx.createOrReveal();
    this.ctx.postWhenReady({ type: 'mergeOpen', path });
  }

  /** The file the Merge modal is open for, if any. */
  openPath(): string | undefined {
    return this.opened;
  }

  async handle(message: MergeWebviewMessage): Promise<void> {
    switch (message.type) {
      case 'mergeReady':
        await this.init(message.path);
        return;
      case 'mergeResolve':
        await this.resolve(message.path, message.text);
        return;
      case 'mergeCancel':
        this.opened = undefined;
        return;
      case 'mergeOpenInEditor':
        this.opened = undefined;
        await this.ctx.changes.openConflictInMergeEditor(message.path);
        return;
    }
  }

  private async init(path: string): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root) {
      this.post({ type: 'mergeError', message: l10n.t('No Git repository is open.') });
      return;
    }
    try {
      const file = await this.service.load(root, path);
      this.post({ type: 'mergeInit', path, text: file.text, incoming: file.incoming, current: file.current, ours: file.ours, theirs: file.theirs });
      const colors = (await readActiveEditorTokenColors().catch((error) => {
        log.warn('could not read editor token colors', error);
        return undefined;
      })) ?? editorTokenColorsFromRules([], undefined);
      this.post({ type: 'editorTokenColors', colors });
    } catch (error) {
      log.error(`could not read ${path} to merge it`, error);
      this.post({ type: 'mergeError', message: error instanceof Error ? error.message : String(error) });
    }
  }

  /** Keeps one side of a conflict that cannot be merged line by line, which resolves it. */
  async takeSide(path: string, side: 'incoming' | 'current'): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root) {
      return;
    }
    try {
      await this.service.takeSide(root, path, side);
    } catch (error) {
      log.error(`could not keep the ${side} side of ${path}`, error);
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      return;
    }
    await this.refresh();
  }

  /**
   * Resolves conflicted files with a language model, one after the other, and stages each result. A file the model
   * cannot settle, or that cannot be merged line by line, is left in conflict. The notification offers to undo.
   */
  async resolveWithAi(paths: readonly string[]): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root) {
      return;
    }
    if (paths.length === 0) {
      void vscode.window.showInformationMessage(l10n.t('There are no conflicted files to resolve.'));
      return;
    }
    const resolved: string[] = [];
    const left: { path: string; reason: string }[] = [];
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: l10n.t('Resolving conflicts with AI…'), cancellable: true },
      async (progress, token) => {
        for (const [index, path] of paths.entries()) {
          if (token.isCancellationRequested) {
            return;
          }
          progress.report({ message: l10n.t('{0} ({1}/{2})', path, index + 1, paths.length) });
          try {
            const reason = await this.resolveOne(root, path, token);
            if (reason === undefined) {
              resolved.push(path);
            } else {
              left.push({ path, reason });
            }
          } catch (error) {
            if (error instanceof NoLanguageModelError) {
              void vscode.window.showInformationMessage(
                l10n.t('No language model is available. Sign in to GitHub Copilot or install a model provider to resolve conflicts.'),
              );
              return;
            }
            if (token.isCancellationRequested) {
              return;
            }
            log.error(`could not resolve ${path} with AI`, error);
            left.push({ path, reason: error instanceof Error ? error.message : String(error) });
          }
        }
      },
    );
    if (resolved.length > 0) {
      if (this.opened !== undefined && resolved.includes(this.opened)) {
        this.close(this.opened);
      }
      await this.refresh();
    }
    this.report(root, resolved, left);
  }

  /** Why a file was left in conflict, or `undefined` once the model's answer is written and staged. */
  private async resolveOne(root: string, path: string, token: vscode.CancellationToken): Promise<string | undefined> {
    const file = await this.service.load(root, path).catch((error) => {
      log.debug(`${path} cannot be read to merge it`, error);
      return undefined;
    });
    if (!file) {
      return l10n.t('it cannot be read');
    }
    const base = await this.service.loadBase(root, path);
    if (conflictsOf(parseMergeDocument(file.text)).length === 0) {
      return this.resolveWholeFile(root, path, file, base, token);
    }
    const prompt = { path, text: file.text, ...(base === undefined ? {} : { base }), current: file.current, incoming: file.incoming };
    if (!fitsConflictPrompt(prompt)) {
      return l10n.t('it is too large to send to the model');
    }
    const parsed = parseResolvedFile(await this.model(buildConflictPrompt(prompt), token), file.text);
    if (!parsed.ok) {
      log.warn(`the model's answer for ${path} was refused: ${parsed.reason}`);
      return parsed.reason === 'markers'
        ? l10n.t('the model left conflict markers in it')
        : l10n.t('the model did not return a file');
    }
    await this.service.resolve(root, path, parsed.text);
    return undefined;
  }

  /** A conflict with no markers: both sides changed the whole file, or one deleted it. Binary files are left alone. */
  private async resolveWholeFile(
    root: string, path: string, file: MergeResolverFile, base: string | undefined, token: vscode.CancellationToken,
  ): Promise<string | undefined> {
    const [current, incoming] = await Promise.all([
      file.currentExists ? this.service.loadStage(root, path, 2) : undefined,
      file.incomingExists ? this.service.loadStage(root, path, 3) : undefined,
    ]);
    if ((current === undefined && incoming === undefined) || isBinaryText(base, current, incoming)) {
      return l10n.t('it is a binary file, or a submodule');
    }
    const prompt = buildWholeFilePrompt({
      path, ...(base === undefined ? {} : { base }), ...(current === undefined ? {} : { current }),
      ...(incoming === undefined ? {} : { incoming }), currentSide: file.current, incomingSide: file.incoming,
    });
    if (!fitsConflictPrompt({ text: (current ?? '') + (incoming ?? ''), ...(base === undefined ? {} : { base }) })) {
      return l10n.t('it is too large to send to the model');
    }
    const reply = await this.model(prompt, token);
    const deletedBy = current === undefined ? 'current' : incoming === undefined ? 'incoming' : undefined;
    if (deletedBy && isDeleteAnswer(reply)) {
      await this.service.takeSide(root, path, deletedBy);
      return undefined;
    }
    const parsed = parseResolvedFile(reply, current ?? incoming ?? '');
    if (!parsed.ok) {
      log.warn(`the model's answer for ${path} was refused: ${parsed.reason}`);
      return l10n.t('the model did not return a file');
    }
    await this.service.resolve(root, path, parsed.text);
    return undefined;
  }

  private report(root: string, resolved: readonly string[], left: readonly { path: string; reason: string }[]): void {
    for (const { path, reason } of left) {
      log.info(`${path} was left in conflict: ${reason}`);
    }
    if (left.length > 0) {
      const first = left[0];
      void vscode.window.showWarningMessage(
        left.length === 1
          ? l10n.t('{0} was left in conflict: {1}.', first.path, first.reason)
          : l10n.t('{0} files were left in conflict. {1} was left because {2}.', left.length, first.path, first.reason),
      );
    }
    if (resolved.length === 0) {
      return;
    }
    const undo = l10n.t('Undo');
    void vscode.window
      .showInformationMessage(
        resolved.length === 1
          ? l10n.t('Resolved {0} with AI and staged it. Review the result before you continue.', resolved[0])
          : l10n.t('Resolved {0} files with AI and staged them. Review the results before you continue.', resolved.length),
        undo,
      )
      .then(async (choice) => {
        if (choice !== undo) {
          return;
        }
        try {
          await this.service.reopen(root, resolved);
        } catch (error) {
          log.error('could not put the conflicts back', error);
          void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
        }
        await this.refresh();
      });
  }

  private async resolve(path: string, text: string): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root) {
      return;
    }
    try {
      await this.service.resolve(root, path, text);
    } catch (error) {
      log.error(`could not resolve ${path}`, error);
      this.post({ type: 'mergeError', message: error instanceof Error ? error.message : String(error) });
      return;
    }
    this.close(path);
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    this.ctx._onDidChangeRefs.fire();
    await this.ctx.changes.sendWorkingCopySnapshot();
    await this.ctx.postState('state');
  }

  private close(path: string): void {
    this.opened = undefined;
    this.post({ type: 'mergeClose', path });
  }

  private post(message: MergeHostMessage): void {
    this.ctx.postWhenReady(message);
  }
}
