import * as l10n from '@vscode/l10n';
import {
  changesCommitBlocker,
  DEFAULT_CHANGES_VIEW,
  DEFAULT_SUBJECT_LIMITS,
  filterChangeEntries,
  subjectLengthLevel,
  type ChangesHostMessage,
  type ChangesViewOptions,
  type SubjectLengthLimits,
} from '../../src/shared/changes/changesProtocol';
import { DEFAULT_WORKING_COPY_DIFF_VIEW_OPTIONS } from '../../src/shared/diff/diffViewOptions';
import type {
  HostMessage,
  WebviewMessage,
  WorkingCopyDiffSide,
  WorkingCopyEntryDto,
} from '../protocol';
import { buildHunkPatch } from '../../src/shared/changes/hunkPatch';
import { ACTION_ICONS } from '../../src/shared/app/actionIcons';
import { mountCodeViewer, type HunkAction } from './codeViewer';
import { renderNonTextDiff } from './nonTextDiffView';
import { html, nothing, render } from 'lit';
import { live } from 'lit/directives/live.js';
import type { VscodeCheckbox } from '@vscode-elements/elements/dist/vscode-checkbox/index.js';
import type { VscodeTextarea } from '@vscode-elements/elements/dist/vscode-textarea/index.js';
import type { VscodeTextfield } from '@vscode-elements/elements/dist/vscode-textfield/index.js';


interface Selection {
  path: string;
  side: WorkingCopyDiffSide;
}

/**
 * The working copy's diff above the commit message form. The Unstaged and Staged lists are native
 * tree views; the host tells this view which change they selected, and it picks what to show when
 * the changes themselves change.
 */
export function mountChangesView(
  container: HTMLElement,
  postMessage: (message: WebviewMessage) => void,
): { applyHostMessage(message: HostMessage): void } {
  render(nothing, container);
  container.classList.add('changes');

  let allEntries: WorkingCopyEntryDto[] = [];
  let view: ChangesViewOptions = { ...DEFAULT_CHANGES_VIEW };
  let selected: Selection | undefined;
  let branch: string | undefined;

  const shown = (): WorkingCopyEntryDto[] => filterChangeEntries(allEntries, view);
  const unstagedEntries = (): WorkingCopyEntryDto[] => shown().filter((entry) => entry.group !== 'staged');
  const stagedEntries = (): WorkingCopyEntryDto[] => shown().filter((entry) => entry.group === 'staged');
  const sideOf = (entry: WorkingCopyEntryDto): WorkingCopyDiffSide => (entry.group === 'staged' ? 'staged' : 'unstaged');

  return mountMain();

  function mountMain(): { applyHostMessage(message: HostMessage): void } {
    const form = { subject: '', description: '', amend: false, generating: false };
    let subjectLimits: SubjectLengthLimits = { ...DEFAULT_SUBJECT_LIMITS };

    function subjectHint(): string | undefined {
      const level = subjectLengthLevel(form.subject, subjectLimits);
      const length = form.subject.trim().length;
      return level === 'limit'
        ? l10n.t('The subject is {0} characters, over the limit of {1}.', length, subjectLimits.limit)
        : level === 'warning'
          ? l10n.t('The subject is {0} characters; aim for {1} or fewer.', length, subjectLimits.warning)
          : undefined;
    }

    const blocker = (): ReturnType<typeof changesCommitBlocker> =>
      changesCommitBlocker(stagedEntries().length, form.subject, form.amend);

    function generateTitle(): string {
      return form.generating
        ? l10n.t('Writing a commit message…')
        : stagedEntries().length === 0
          ? l10n.t('Stage changes to write a commit message')
          : l10n.t('Write a commit message with AI');
    }

    function commitTitle(): string {
      const reason = blocker();
      return reason === 'nothingStaged'
        ? l10n.t('Stage changes to commit them')
        : reason === 'noSubject'
          ? l10n.t('Type a commit subject')
          : l10n.t('Commit {0} staged change(s)', stagedEntries().length);
    }

    function messagePlaceholder(): string {
      return branch
        ? l10n.t("Message (Ctrl/Cmd+Enter to commit on '{0}'; add Shift to also push to the remote)", branch)
        : l10n.t('Message (Ctrl/Cmd+Enter to commit; add Shift to also push to the remote)');
    }

    /** The diff above, and the commit form below it. */
    function paint(): void {
      const noneStaged = stagedEntries().length === 0;
      const hint = subjectHint();
      render(html`
        <div class="changes-diff commit-file-diff"></div>
        <div class="changes-form">
          <div class="changes-subject-row">
            <vscode-textfield class="changes-subject"
              placeholder=${messagePlaceholder()}
              ?invalid=${subjectLengthLevel(form.subject, subjectLimits) === 'limit'}
              aria-label=${l10n.t('Commit subject')} .value=${live(form.subject)}
              @input=${(event: Event) => { form.subject = (event.target as VscodeTextfield).value; paint(); }}>
              <vscode-button type="button" class="changes-generate" slot="content-after" icon=${ACTION_ICONS.generateMessage} icon-only
                ?disabled=${noneStaged || form.generating} title=${generateTitle()} aria-label=${generateTitle()}
                @click=${() => postMessage({ type: 'changesGenerateMessage' })}></vscode-button>
            </vscode-textfield>
          </div>
          ${hint ? html`<div class="changes-subject-hint" role="status">${hint}</div>` : nothing}
          <vscode-textarea class="changes-description" rows="3" placeholder=${l10n.t('Body')}
            aria-label=${l10n.t('Commit body')} .value=${live(form.description)}
            @input=${(event: Event) => { form.description = (event.target as VscodeTextarea).value; }}></vscode-textarea>
          <div class="changes-form-footer">
            <vscode-checkbox class="changes-amend" label=${l10n.t('Amend')} .checked=${live(form.amend)}
              @change=${(event: Event) => {
                form.amend = (event.target as VscodeCheckbox).checked;
                if (form.amend) { postMessage({ type: 'changesAmend' }); }
                paint();
              }}></vscode-checkbox>
            <vscode-button-group>
              <vscode-button type="button" class="changes-commit" ?disabled=${blocker() !== undefined} title=${commitTitle()}
                @click=${() => submit()}>${l10n.t('Commit')}</vscode-button>
              <vscode-button type="button" secondary class="changes-commit-push" ?disabled=${blocker() !== undefined}
                title=${l10n.t('Commit, then choose what to push')}
                @click=${() => submit(false, true)}>${l10n.t('Commit and push…')}</vscode-button>
            </vscode-button-group>
          </div>
        </div>`, container);
    }

    /** `push` pushes at once with the usual choices; `pushForm` opens the Push form after the commit. */
    function submit(push = false, pushForm = false): void {
      if (blocker() !== undefined) {
        return;
      }
      postMessage({
        type: 'changesCommit',
        subject: form.subject.trim(),
        description: form.description.trim(),
        amend: form.amend,
        ...(push ? { push } : {}),
        ...(pushForm ? { pushForm } : {}),
      });
    }

    // The list shortcuts do not reach this webview, so the same keys press Commit from the form.
    container.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing || event.altKey || !(event.metaKey || event.ctrlKey)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      submit(event.shiftKey);
    }, true);

    paint();
    const diff = container.querySelector<HTMLElement>('.changes-diff')!;
    const viewer = mountCodeViewer(diff);
    viewer.showMessage(l10n.t('Select a change to see its diff.'));

    let renderedKey: string | undefined;

    /** Keeps the selection on the same change, following it between Unstaged and Staged. */
    function reconcileSelection(): void {
      const entries = shown();
      const stillThere = (candidate: Selection): boolean =>
        entries.some((entry) => entry.path === candidate.path && sideOf(entry) === candidate.side);
      if (selected && stillThere(selected)) {
        postMessage({ type: 'changesSelect', ...selected });
        return;
      }
      const moved = selected && entries.find((entry) => entry.path === selected?.path);
      const next = moved ?? unstagedEntries()[0] ?? stagedEntries()[0];
      if (!next) {
        selected = undefined;
        renderedKey = undefined;
        viewer.showMessage(l10n.t('No changes.'));
        postMessage({ type: 'changesSelect', path: '', side: 'unstaged' });
        return;
      }
      postMessage({ type: 'changesSelect', path: next.path, side: sideOf(next) });
    }

    function showDiff(message: Extract<ChangesHostMessage, { type: 'changesDiff' }>): void {
      if (message.path !== selected?.path || message.side !== selected.side) {
        return;
      }
      const key = `${message.side}\0${message.path}`;
      const keepScroll = renderedKey === key;
      renderedKey = key;
      if (message.error) {
        viewer.showMessage(l10n.t('Could not load this diff: {0}', message.error), true);
      } else if (message.nonText) {
        viewer.showMessage('');
        renderNonTextDiff(diff, message.nonText, DEFAULT_WORKING_COPY_DIFF_VIEW_OPTIONS, () => undefined);
      } else {
        viewer.setHunkActions(hunkActionsFor(message));
        void viewer.showDiff(message.path, message.lines, message.binary, keepScroll);
      }
    }

    /** Stage and discard buttons over each hunk of an unstaged change; Unstage over a staged one. */
    function hunkActionsFor(
      message: Extract<ChangesHostMessage, { type: 'changesDiff' }>,
    ): ((hunkIndex: number) => HunkAction[]) | undefined {
      const entry = allEntries.find((candidate) => candidate.path === message.path && sideOf(candidate) === message.side);
      if (!entry || entry.status === 'ignored') {
        return undefined;
      }
      if (entry.group === 'untracked') {
        // A new file is one hunk with nothing to patch against, so it stages or goes as a whole.
        return () => [
          { label: l10n.t('Stage'), run: () => postMessage({ type: 'changesActions', actions: [{ op: 'stage', path: entry.path }] }) },
          { label: l10n.t('Discard Changes…'), run: () => postMessage({ type: 'changesActions', actions: [{ op: 'discard', path: entry.path }] }) },
        ];
      }
      const apply = (index: number, op: 'stage' | 'unstage' | 'discard'): void => {
        const patch = buildHunkPatch(message.path, message.lines, index);
        if (patch) {
          postMessage({ type: 'changesHunk', path: message.path, op, patch });
        }
      };
      return (index) =>
        message.side === 'staged'
          ? [{ label: l10n.t('Unstage'), run: () => apply(index, 'unstage') }]
          : [
              { label: l10n.t('Stage'), run: () => apply(index, 'stage') },
              { label: l10n.t('Discard Changes…'), run: () => apply(index, 'discard') },
            ];
    }

    return {
      applyHostMessage(message): void {
        switch (message.type) {
          case 'workingCopySnapshot':
            allEntries = message.snapshot.entries;
            branch = message.snapshot.branch;
            paint();
            reconcileSelection();
            return;
          case 'changesView':
            view = message.options;
            paint();
            reconcileSelection();
            return;
          case 'changesSubjectLimits':
            subjectLimits = message.limits;
            paint();
            return;
          case 'changesSelection':
            selected = message.selection ?? undefined;
            return;
          case 'commitDiffView':
            viewer.setOptions(message.options);
            return;
          case 'editorTokenColors':
            viewer.setTokenColors(message.colors);
            return;
          case 'changesDiff':
            showDiff(message);
            return;
          case 'changesShortcut':
            if (message.action === 'focusCommit') {
              container.querySelector<HTMLElement>('.changes-subject')?.focus();
            } else {
              submit(message.action === 'commitAndPush');
            }
            return;
          case 'changesGenerating':
            form.generating = message.busy;
            paint();
            return;
          case 'changesGeneratedMessage':
          case 'changesAmendMessage':
            form.subject = message.subject;
            form.description = message.description;
            paint();
            return;
          case 'changesCommitted':
            form.subject = '';
            form.description = '';
            form.amend = false;
            paint();
            return;
          default:
            return;
        }
      },
    };
  }
}
