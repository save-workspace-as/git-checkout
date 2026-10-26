import * as l10n from '@vscode/l10n';
import { html, nothing, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import type { GitHubRepository } from '../../src/shared/history/githubReferences';
import type { BlameCommitDto } from '../../src/shared/history/pathHistoryProtocol';
import { githubLinkedText } from '../githubLinkText';
import { authorColor, authorInitials, formatCommitDate } from '../protocol';
import { runStarts } from './blameLayout';

export interface BlameGutterInput {
  /** The commit that last changed each diff line, as the host sent it. */
  shas: readonly string[];
  commits: Record<string, BlameCommitDto>;
  github: GitHubRepository | null;
  /** Commits that can be selected from a blame cell: those the dropdown lists. */
  isListed(sha: string): boolean;
}

export interface BlameGutterActions {
  select(sha: string): void;
  openLink(url: string): void;
}

/**
 * The cell before each line of the diff: the author, hash, subject and date of the commit that last
 * changed the line, shown once for a run of lines from the same commit.
 */
export function blameGutter(
  input: BlameGutterInput,
  actions: BlameGutterActions,
  now = new Date(),
): (index: number) => TemplateResult | undefined {
  const starts = runStarts(input.shas);
  return (index) => {
    const sha = input.shas[index] ?? '';
    const commit = input.commits[sha];
    if (!starts[index] || !commit) { return undefined; }
    return html`
      <span class="graph-avatar" style=${styleMap({ background: `var(--graph-lane-${authorColor(commit.authorMail)})` })}
        >${authorInitials(commit.author)}</span>
      <button type="button" class="blame-hash" title=${input.isListed(sha) ? l10n.t('Show this commit') : sha}
        ?disabled=${!input.isListed(sha)} @click=${() => actions.select(sha)}>${sha.slice(0, 7)}</button>
      <span class="blame-summary" title=${commit.summary}
        >${githubLinkedText(commit.summary, input.github, actions.openLink)}</span>
      <span class="blame-date">${formatCommitDate(commit.authorTime, now)}</span>${nothing}`;
  };
}
