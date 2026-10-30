import { html, type TemplateResult } from 'lit';
import { parseAutolinksAttribute, segmentReferences, type AutolinkRule } from '../src/shared/history/autolinks';
import type { GitHubRepository } from '../src/shared/history/githubReferences';

let cached: { attribute: string | undefined; rules: AutolinkRule[] } | undefined;

/** The autolinks the extension put on the page, parsed once for as long as they do not change. */
function autolinks(): AutolinkRule[] {
  const attribute = document.body?.dataset.autolinks;
  if (!cached || cached.attribute !== attribute) {
    cached = { attribute, rules: parseAutolinksAttribute(attribute) };
  }
  return cached.rules;
}

/** Text in which issue and pull request references are links that open on the forge. */
export function githubLinkedText(
  text: string,
  repo: GitHubRepository | null,
  open: (url: string) => void,
): TemplateResult {
  return html`${segmentReferences(text, repo, autolinks()).map((part) => part.kind === 'text'
    ? part.text
    : html`<button type="button" class="github-ref" title=${part.url} @click=${(event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      open(part.url);
    }}>${part.text}</button>`)}`;
}
