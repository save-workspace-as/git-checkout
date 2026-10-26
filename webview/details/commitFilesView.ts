import type { GitHubRepository } from '../../src/shared/history/githubReferences';
import type { CommitPersonDto, GraphCommitDto, HostMessage, WebviewMessage } from '../protocol';
import { html, render } from 'lit';
import { commitSummaryTemplate } from './commitSummary';

/**
 * The commit summary (the same component the rebase editor uses): who made the commit, its message and
 * links. The changed files beside it are a native view.
 */
export function mountCommitFilesView(
  container: HTMLElement,
  postMessage: (message: WebviewMessage) => void,
): {
  applyHostMessage(message: HostMessage): void;
} {
  container.classList.add('commit-files');

  let commits: GraphCommitDto[] = [];
  let body = '';
  let committer: CommitPersonDto | undefined;
  let github: GitHubRepository | null = null;

  function paintSummary(): void {
    render(html`
      <div class="commit-files-summary">${(commits.length > 0 ? commits : [null]).map((commit) => html`
        <div>${commitSummaryTemplate(
          { commit, body: commits.length === 1 ? body : '', github, committer: commits.length === 1 ? committer : undefined },
          (url) => postMessage({ type: 'openGitHubLink', url }),
          (sha) => {
            postMessage({ type: 'commitDetailsSelect', sha });
            postMessage({ type: 'commitTreeSetRevision', revision: sha });
          },
        )}</div>`)}
      </div>`, container);
  }

  function reset(next: GraphCommitDto[]): void {
    commits = next;
    body = '';
    committer = undefined;
    paintSummary();
  }

  paintSummary();

  return {
    applyHostMessage(message): void {
      switch (message.type) {
        case 'commitDetailsPreview':
          reset([message.commit]);
          return;
        case 'commitComparePreview':
          reset([message.base, message.commit]);
          return;
        case 'graphMeta':
          github = message.github;
          paintSummary();
          return;
        case 'graphAvatars': {
          let changed = false;
          commits = commits.map((commit) => {
            const avatarUrl = message.avatars[commit.authorEmail.trim().toLowerCase()];
            if (!avatarUrl || commit.avatarUrl === avatarUrl) {
              return commit;
            }
            changed = true;
            return { ...commit, avatarUrl };
          });
          if (changed) {
            paintSummary();
          }
          return;
        }
        case 'commitDetails': {
          const target = commits[commits.length - 1];
          const base = commits.length > 1 ? commits[0].sha : undefined;
          if (!target || message.details.sha !== target.sha || (message.details.baseSha ?? undefined) !== base) {
            return;
          }
          body = message.details.body;
          committer = message.details.committer;
          paintSummary();
          return;
        }
        default:
          return;
      }
    },
  };
}
