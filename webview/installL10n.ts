import { config } from '@vscode/l10n';
import { parseL10nAttribute } from '../src/shared/app/l10nAttribute';

// Imported first by every webview entry, so strings built at load time are already translated.
const contents = parseL10nAttribute(document.body?.dataset.l10n);
if (contents) {
  config({ contents });
}
