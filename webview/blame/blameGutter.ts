import * as l10n from '@vscode/l10n';
import { html, nothing, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import type { GitHubRepository } from '../../src/shared/history/githubReferences';
import type { BlameCommitDto } from '../../src/shared/history/pathHistoryProtocol';
import { ACTION_ICONS } from '../../src/shared/app/actionIcons';
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
  /** The commit whose change is shown. */
  selectedSha: string | null;
  /** The line's number in the file as the selected commit left it, for a line that exists there. */
  lineOf(index: number): number | undefined;
}

export interface BlameGutterActions {
  select(sha: string): void;
  /** Show the commit that changed the line before the selected commit did. */
  stepBack(line: number): void;
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
    // A line the selected commit changed has nothing newer to show; what it replaced is the earlier version.
    const line = sha === input.selectedSha ? input.lineOf(index) : undefined;
    return html`
      <span class="graph-avatar" style=${styleMap({ background: `var(--graph-lane-${authorColor(commit.authorMail)})` })}
        >${authorInitials(commit.author)}</span>
      <button type="button" class="blame-hash" title=${input.isListed(sha) ? l10n.t('Show this commit') : sha}
        ?disabled=${!input.isListed(sha)} @click=${() => actions.select(sha)}>${sha.slice(0, 7)}</button>
      <span class="blame-summary" title=${commit.summary}
        >${githubLinkedText(commit.summary, input.github, actions.openLink)}</span>
      <span class="blame-date">${formatCommitDate(commit.authorTime, now)}</span>${line === undefined ? nothing : html`
      <vscode-toolbar-button class="blame-before" icon=${ACTION_ICONS.blameBefore} label=${l10n.t('Blame before this change')}
        title=${l10n.t('Blame before this change')} @click=${() => actions.stepBack(line)}></vscode-toolbar-button>`}`;
  };
}
