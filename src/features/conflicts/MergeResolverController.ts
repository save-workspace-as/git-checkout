import * as l10n from '@vscode/l10n';
import { createLogger } from '../../log';
import { conflictsOf, parseMergeDocument } from '../../shared/conflicts/mergeDocument';
import type { MergeHostMessage, MergeWebviewMessage } from '../../shared/conflicts/mergeProtocol';
import type { GitCheckoutPanelManager } from '../../panel/gitCheckoutPanelManager';
import { readActiveEditorTokenColors } from '../../panel/activeEditorTheme';
import { editorTokenColorsFromRules } from '../../shared/diff/editorTokenColors';
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
