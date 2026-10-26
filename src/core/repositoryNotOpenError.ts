import * as l10n from '@vscode/l10n';

/** A repository the window was working with is no longer open, as when its folder is closed mid-operation. */
export class RepositoryNotOpenError extends Error {
  constructor() {
    super(l10n.t('Repository is not open.'));
    this.name = 'RepositoryNotOpenError';
  }
}
