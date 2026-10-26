import * as vscode from 'vscode';
import { parseGitCheckoutBlobUri } from './gitCheckoutUri';
import type { GitRevisionContentService } from './gitRevisionContentService';
import { createLogger } from '../log';

const log = createLogger('git-checkout-uri');

export class GitCheckoutContentProvider implements vscode.TextDocumentContentProvider {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();

  readonly onDidChange = this.changeEmitter.event;

  constructor(private readonly revisionContent: GitRevisionContentService) {}

  refresh(uri: vscode.Uri): void {
    this.changeEmitter.fire(uri);
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const location = parseGitCheckoutBlobUri(uri);
    if (!location) {
      log.warn('ignored malformed git-checkout URI');
      return '';
    }
    try {
      return await this.revisionContent.readFileAtRevision(
        location.repoRoot,
        location.revision,
        location.path,
      );
    } catch (error) {
      log.error(`could not load ${location.path} at ${location.revision}`, error);
      return `// Could not load ${location.path} at ${location.revision}`;
    }
  }
}
