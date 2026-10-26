import { html, nothing, type TemplateResult } from 'lit';
import * as l10n from '@vscode/l10n';
import { githubLinkedText } from '../githubLinkText';
import { formatCommitDate, type GraphCommitDto } from '../protocol';
import type { GitHubRepository } from '../../src/shared/history/githubReferences';

interface CommitSummary {
  commit: GraphCommitDto | null;
  body: string;
  github: GitHubRepository | null;
  subject?: string;
  /** Shown as its own row when it is a different person from the author. */
  committer?: { name: string; email: string; date: number };
}

/** Who made the commit, its hash and parents, and its message, with issue and pull request references as links. */
export function commitSummaryTemplate(
  { commit, body, github, subject, committer }: CommitSummary,
  openLink: (url: string) => void,
  selectParent?: (sha: string) => void,
): TemplateResult {
  const initials = (commit?.author ?? '').split(/\s+/).filter(Boolean)
    .slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('') || '?';
  const author = commit?.author || (!commit && subject === undefined ? l10n.t('Select a commit in the graph.') : '');
  const url = github && commit
    ? `https://${github.host}/${github.owner}/${github.repo}/commit/${commit.sha}` : '';
  const subjectText = subject ?? commit?.subject ?? '';
  const parents = commit?.parents ?? [];
  const committerText = committerLabel(commit, committer);

  return html`
    <div class="commit-meta">
      <div class="commit-avatar">${initials}${commit?.avatarUrl
        ? html`<img class="commit-avatar-image" alt="" src=${commit.avatarUrl}
            @error=${(event: Event) => (event.target as HTMLElement).remove()}>` : nothing}</div>
      <div class="commit-author">
        <span class="commit-author-label">${l10n.t('Author')}</span>
        <div class="commit-author-identity">
          <h3 class="commit-author-name">${author}</h3>
          <span class="commit-author-email" title=${commit?.authorEmail ?? ''}>${commit?.authorEmail ?? ''}</span>
        </div>
        <span class="commit-author-date"
          title=${commit?.authorDate ? new Date(commit.authorDate * 1000).toLocaleString() : ''}
        >${commit?.authorDate ? formatCommitDate(commit.authorDate) : ''}</span>
      </div>
      <div class="commit-identity">
        ${commit ? html`
          <div class="commit-meta-row">
            <span class="commit-meta-key">${l10n.t('Hash')}</span>
            <span class="commit-meta-value commit-sha" title=${commit.sha}>${commit.sha}${url ? html`
              <button type="button" class="commit-github" aria-label=${l10n.t('Open commit on GitHub')}
                title=${l10n.t('Open commit on GitHub')} @click=${() => openLink(url)}>GitHub</button>` : nothing}</span>
          </div>` : nothing}
        ${parents.length > 0 ? html`
          <div class="commit-meta-row">
            <span class="commit-meta-key">${l10n.t('Parents')}</span>
            <span class="commit-meta-value" title=${parents.join(' ')}>${selectParent
              ? parents.map((parent) => html`<button type="button" class="commit-parent"
                  @click=${() => selectParent(parent)}>${parent.slice(0, 7)}</button>`)
              : parents.map((parent) => parent.slice(0, 7)).join(' ')}</span>
          </div>` : nothing}
        ${committerText ? html`
          <div class="commit-meta-row">
            <span class="commit-meta-key">${l10n.t('Committer')}</span>
            <span class="commit-meta-value" title=${committerText}>${committerText}</span>
          </div>` : nothing}
      </div>
    </div>
    <h2 class="commit-subject" title=${subjectText}>${githubLinkedText(subjectText, github, openLink)}</h2>
    <p class=${body.trim().length === 0 ? 'commit-details-message hidden' : 'commit-details-message'} title=${body}
    >${githubLinkedText(body, github, openLink)}</p>`;
}

/** `Name <email> · date` for a committer who is not the author, else empty. */
function committerLabel(commit: GraphCommitDto | null, committer: CommitSummary['committer']): string {
  if (!commit || !committer || (!committer.name && !committer.email)) {
    return '';
  }
  if (committer.name === commit.author && committer.email === commit.authorEmail) {
    return '';
  }
  const identity = committer.email ? `${committer.name} <${committer.email}>` : committer.name;
  return committer.date ? `${identity} · ${formatCommitDate(committer.date)}` : identity;
}
