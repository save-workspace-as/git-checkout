import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { createLogger } from '../../log';
import { buildConflictPrompt, buildWholeFilePrompt, fitsConflictPrompt, isBinaryText, isDeleteAnswer, parseResolvedFile } from '../../shared/conflicts/conflictPrompt';
import { conflictsOf, parseMergeDocument } from '../../shared/conflicts/mergeDocument';
import type { MergeHostMessage, MergeWebviewMessage } from '../../shared/conflicts/mergeProtocol';
import type { GitCheckoutPanelManager } from '../../panel/gitCheckoutPanelManager';
import { readActiveEditorTokenColors } from '../../panel/activeEditorTheme';
import { editorTokenColorsFromRules } from '../../shared/diff/editorTokenColors';
import { aiDisabledMessage, AiDisabledError, askLanguageModel, NoLanguageModelError } from '../../core/languageModel';
import type { MergeResolverFile } from './mergeResolverService';
import { MergeResolverService } from './mergeResolverService';

const log = createLogger('merge-resolver');

/** What the model made of a conflicted file: the file to write, or its deletion. */
type Proposal = { kind: 'file'; text: string; original: string } | { kind: 'delete'; side: 'current' | 'incoming' };

/** What MergeResolverController needs from the window that owns it. */
export type MergeResolverContext = Pick<
  GitCheckoutPanelManager,
  '_onDidChangeRefs' | 'activeRepoRoot' | 'changes' | 'cliRegistry' | 'createOrReveal' | 'postState' | 'postWhenReady'
>;

/** The Merge modal: one conflicted file, with the two sides to choose from and the result below. */
export class MergeResolverController {
  private resolver: MergeResolverService | undefined;
  private opened: string | undefined;

  constructor(private readonly ctx: MergeResolverContext) {}


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
    const proposals = new Map<string, Proposal>();
    const left: { path: string; reason: string }[] = [];
    let canceled = false;
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: l10n.t('Resolving conflicts with AI…'), cancellable: true },
      async (progress, token) => {
        for (const [index, path] of paths.entries()) {
          if (token.isCancellationRequested) {
            canceled = true;
            return;
          }
          progress.report({ message: l10n.t('{0} ({1}/{2})', path, index + 1, paths.length) });
          try {
            const proposal = await this.propose(root, path, token);
            if ('reason' in proposal) {
              left.push({ path, reason: proposal.reason });
            } else {
              proposals.set(path, proposal);
            }
          } catch (error) {
            if (error instanceof AiDisabledError) {
              void vscode.window.showInformationMessage(aiDisabledMessage());
              canceled = true;
              return;
            }
            if (error instanceof NoLanguageModelError) {
              void vscode.window.showInformationMessage(
                l10n.t('No language model is available. Sign in to GitHub Copilot or install a model provider to resolve conflicts.'),
              );
              canceled = true;
              return;
            }
            if (token.isCancellationRequested) {
              canceled = true;
              return;
            }
            log.error(`could not resolve ${path} with AI`, error);
            left.push({ path, reason: error instanceof Error ? error.message : String(error) });
          }
        }
      },
    );
    if (canceled) {
      return;
    }
    const review = vscode.workspace.getConfiguration('gitCheckout.ai').get<boolean>('reviewConflictResolutions', false);
    const resolved: string[] = [];
    for (const [path, proposal] of proposals) {
      if (review && !(await this.accepted(path, proposal))) {
        left.push({ path, reason: l10n.t('you chose not to accept the result') });
        continue;
      }
      try {
        await (proposal.kind === 'delete'
          ? this.service.takeSide(root, path, proposal.side)
          : this.service.resolve(root, path, proposal.text));
        resolved.push(path);
      } catch (error) {
        log.error(`could not write the resolution of ${path}`, error);
        left.push({ path, reason: error instanceof Error ? error.message : String(error) });
      }
    }
    if (resolved.length > 0) {
      if (this.opened !== undefined && resolved.includes(this.opened)) {
        this.close(this.opened);
      }
      await this.refresh();
    }
    this.report(root, resolved, left);
  }

  /** Asks the model, and once more when a request fails: a model can decline one time and answer the next. */
  private async ask(prompt: string, token: vscode.CancellationToken): Promise<string> {
    try {
      return await askLanguageModel(prompt, token);
    } catch (error) {
      if (error instanceof NoLanguageModelError || error instanceof AiDisabledError || token.isCancellationRequested) {
        throw error;
      }
      log.warn('the model failed on a conflict; asking once more', error);
      return askLanguageModel(prompt, token);
    }
  }

  /** What the model would do with a file, or why it cannot be left to the model. Nothing is written. */
  private async propose(root: string, path: string, token: vscode.CancellationToken): Promise<Proposal | { reason: string }> {
    const file = await this.service.load(root, path).catch((error) => {
      log.debug(`${path} cannot be read to merge it`, error);
      return undefined;
    });
    if (!file) {
      return { reason: l10n.t('it cannot be read') };
    }
    const base = await this.service.loadBase(root, path);
    if (conflictsOf(parseMergeDocument(file.text)).length === 0) {
      return this.proposeWholeFile(root, path, file, base, token);
    }
    const prompt = { path, text: file.text, ...(base === undefined ? {} : { base }), current: file.current, incoming: file.incoming };
    if (!fitsConflictPrompt(prompt)) {
      return { reason: l10n.t('it is too large to send to the model') };
    }
    const parsed = parseResolvedFile(await this.ask(buildConflictPrompt(prompt), token), file.text);
    if (!parsed.ok) {
      log.warn(`the model's answer for ${path} was refused: ${parsed.reason}`);
      return {
        reason: parsed.reason === 'markers' ? l10n.t('the model left conflict markers in it') : l10n.t('the model did not return a file'),
      };
    }
    return { kind: 'file', text: parsed.text, original: file.text };
  }

  /** A conflict with no markers: both sides changed the whole file, or one deleted it. Binary files are left alone. */
  private async proposeWholeFile(
    root: string, path: string, file: MergeResolverFile, base: string | undefined, token: vscode.CancellationToken,
  ): Promise<Proposal | { reason: string }> {
    const [current, incoming] = await Promise.all([
      file.currentExists ? this.service.loadStage(root, path, 2) : undefined,
      file.incomingExists ? this.service.loadStage(root, path, 3) : undefined,
    ]);
    if ((current === undefined && incoming === undefined) || isBinaryText(base, current, incoming)) {
      return { reason: l10n.t('it is a binary file, or a submodule') };
    }
    const prompt = buildWholeFilePrompt({
      path, ...(base === undefined ? {} : { base }), ...(current === undefined ? {} : { current }),
      ...(incoming === undefined ? {} : { incoming }), currentSide: file.current, incomingSide: file.incoming,
    });
    if (!fitsConflictPrompt({ text: (current ?? '') + (incoming ?? ''), ...(base === undefined ? {} : { base }) })) {
      return { reason: l10n.t('it is too large to send to the model') };
    }
    const reply = await this.ask(prompt, token);
    const deletedBy = current === undefined ? 'current' : incoming === undefined ? 'incoming' : undefined;
    if (deletedBy && isDeleteAnswer(reply)) {
      return { kind: 'delete', side: deletedBy };
    }
    const kept = current ?? incoming ?? '';
    const parsed = parseResolvedFile(reply, kept);
    if (!parsed.ok) {
      log.warn(`the model's answer for ${path} was refused: ${parsed.reason}`);
      return { reason: l10n.t('the model did not return a file') };
    }
    return { kind: 'file', text: parsed.text, original: kept };
  }

  /** Shows what the model made of a file next to what Git left, and asks whether to take it. */
  private async accepted(path: string, proposal: Proposal): Promise<boolean> {
    const accept = l10n.t('Accept');
    if (proposal.kind === 'delete') {
      const answer = await vscode.window.showInformationMessage(
        l10n.t('The model decided {0} should be deleted, as the {1} side did. Delete it?', path, proposal.side === 'current' ? l10n.t('current') : l10n.t('incoming')),
        accept, l10n.t('Skip'),
      );
      return answer === accept;
    }
    const [before, after] = await Promise.all([
      vscode.workspace.openTextDocument({ content: proposal.original }),
      vscode.workspace.openTextDocument({ content: proposal.text }),
    ]);
    await vscode.commands.executeCommand('vscode.diff', before.uri, after.uri, l10n.t('{0}: as Git left it ↔ resolved by AI', path));
    const answer = await vscode.window.showInformationMessage(l10n.t('Accept the AI resolution of {0}?', path), accept, l10n.t('Skip'));
    return answer === accept;
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
