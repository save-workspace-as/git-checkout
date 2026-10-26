import { html, type TemplateResult } from 'lit';
import {
  segmentGitHubReferences,
  type GitHubRepository,
} from '../src/shared/history/githubReferences';

/** Text in which issue and pull request references are links that open on the forge. */
export function githubLinkedText(
  text: string,
  repo: GitHubRepository | null,
  open: (url: string) => void,
): TemplateResult {
  return html`${segmentGitHubReferences(text, repo).map((part) => part.kind === 'text'
    ? part.text
    : html`<button type="button" class="github-ref" title=${part.url} @click=${(event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      open(part.url);
    }}>${part.text}</button>`)}`;
}
