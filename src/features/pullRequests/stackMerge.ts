import * as l10n from '@vscode/l10n';
import type { OperationFormDefinition, OperationFormErrors, OperationFormValues } from '../../shared/forms/operationForm';
import { mergeResult, type MergeMethod, type MergeResult, type RestTransport } from './githubRestClient';
import type { GitHubRepository } from '../../shared/history/githubReferences';

/** A pull request of a stack, as the merge form lists it. */
export interface MergeLayer {
  number: number;
  title: string;
  isDraft: boolean;
}

export const MERGE_METHODS: readonly MergeMethod[] = ['merge', 'squash', 'rebase'];

export function mergeStackForm(layers: readonly MergeLayer[]): OperationFormDefinition {
  return {
    title: l10n.t('Merge Stack'),
    submitLabel: l10n.t('Merge'),
    values: { through: String(layers[layers.length - 1].number), method: 'merge' },
    fields: [
      {
        id: 'through', type: 'text', label: l10n.t('Merge through'), required: true,
        description: l10n.t('This pull request and every pull request below it are merged, all or none.'),
        suggestions: layers.map((layer) => ({ value: String(layer.number), label: layer.title })),
      },
      {
        id: 'method', type: 'radio', label: l10n.t('Method'),
        options: [
          { value: 'merge', label: l10n.t('Create a merge commit') },
          { value: 'squash', label: l10n.t('Squash and merge') },
          { value: 'rebase', label: l10n.t('Rebase and merge') },
        ],
      },
    ],
  };
}

/** The pull requests a merge through `number` takes in, bottom first. */
export function mergeSet(layers: readonly MergeLayer[], number: number): MergeLayer[] {
  const index = layers.findIndex((layer) => layer.number === number);
  return index < 0 ? [] : layers.slice(0, index + 1);
}

/** A draft in the set cannot be merged, and GitHub refuses the whole stack for it, so it is said before asking. */
export function validateMergeStackForm(layers: readonly MergeLayer[], values: OperationFormValues): OperationFormErrors {
  const draft = mergeSet(layers, Number(values.through)).find((layer) => layer.isDraft);
  return draft ? { through: l10n.t('Pull request #{0} is a draft. Mark it ready for review first.', draft.number) } : {};
}

export function mergeMethodOf(value: unknown): MergeMethod {
  return MERGE_METHODS.find((method) => method === value) ?? 'merge';
}

export interface WaitOptions {
  intervalMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Asks about a merge that is pending until it is not, or until it has taken too long. */
export async function waitForMerge(
  repo: GitHubRepository,
  token: string,
  number: number,
  first: MergeResult,
  transport: RestTransport,
  { intervalMs = 2000, timeoutMs = 5 * 60_000, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }: WaitOptions = {},
): Promise<MergeResult> {
  let result = first;
  for (let waited = 0; result.status === 'pending' && result.uuid; waited += intervalMs) {
    if (waited >= timeoutMs) {
      throw new Error(l10n.t('The merge is still running. Check the pull requests on GitHub, or merge the stack again to wait for it.'));
    }
    await sleep(intervalMs);
    result = await mergeResult(repo, token, number, result.uuid, transport);
  }
  return result;
}
