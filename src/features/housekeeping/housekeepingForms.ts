import * as l10n from '@vscode/l10n';
import type { OperationFormDefinition, OperationFormErrors, OperationFormField, OperationFormValues } from '../../shared/forms/operationForm';

const itemId = (prefix: string, index: number): string => `${prefix}-${index}`;

/** One checkbox for each of `items`, all in one group. */
export function checklistFields(prefix: string, items: readonly string[], group: string, when?: OperationFormField['when']): OperationFormField[] {
  return items.map((item, index): OperationFormField => ({ id: itemId(prefix, index), type: 'checkbox', label: item, group, when }));
}

/** Starting values for those checkboxes: ticked unless `ticked` says no. */
export function checklistValues(prefix: string, items: readonly string[], ticked: (item: string) => boolean = () => true): OperationFormValues {
  return Object.fromEntries(items.map((item, index) => [itemId(prefix, index), ticked(item)]));
}

/** The items whose checkbox is ticked. */
export function tickedItems(prefix: string, items: readonly string[], values: OperationFormValues): string[] {
  return items.filter((_, index) => values[itemId(prefix, index)] === true);
}

/** An error on the first checkbox of a list when none is ticked. */
export function requireTicked(prefix: string, items: readonly string[], values: OperationFormValues, message: string): OperationFormErrors {
  return tickedItems(prefix, items, values).length === 0 ? { [itemId(prefix, 0)]: message } : {};
}

export const MERGED_PREFIX = 'merged';

export function deleteMergedBranchesForm(branches: readonly string[]): OperationFormDefinition {
  return {
    title: l10n.t('Delete Merged Branches'),
    submitLabel: l10n.t('Delete'),
    values: checklistValues(MERGED_PREFIX, branches),
    fields: checklistFields(MERGED_PREFIX, branches, l10n.t('Local branches already merged into the current branch')),
  };
}

export const UNTRACKED_PREFIX = 'untracked';
export const IGNORED_PREFIX = 'ignored';

export type CleanScope = 'untracked' | 'all';

/** What Clean Untracked Files can delete: `untracked` files and folders, and with the ignored ones, `all`. */
export interface CleanCandidates {
  untracked: readonly string[];
  all: readonly string[];
}

export function cleanForm(found: CleanCandidates): OperationFormDefinition {
  return {
    title: l10n.t('Clean Untracked Files'),
    submitLabel: l10n.t('Delete'),
    notice: { kind: 'warning', message: l10n.t('Deleted files cannot be recovered.') },
    values: { scope: found.untracked.length > 0 ? 'untracked' : 'all', ...checklistValues(UNTRACKED_PREFIX, found.untracked), ...checklistValues(IGNORED_PREFIX, found.all) },
    fields: [
      {
        id: 'scope', type: 'radio', label: l10n.t('What to clean'),
        options: [
          { value: 'untracked', label: l10n.t('Untracked files') },
          { value: 'all', label: l10n.t('Untracked and ignored files') },
        ],
        description: l10n.t('Ignored files include build output and caches.'),
      },
      ...checklistFields(UNTRACKED_PREFIX, found.untracked, l10n.t('Files and folders to delete'), { field: 'scope', value: 'untracked' }),
      ...checklistFields(IGNORED_PREFIX, found.all, l10n.t('Files and folders to delete'), { field: 'scope', value: 'all' }),
    ],
  };
}

/** The files and folders the filled-in form asks to delete, and whether that includes the ignored ones. */
export function cleanChoice(found: CleanCandidates, values: OperationFormValues): { paths: string[]; ignored: boolean } {
  const ignored = values.scope === 'all';
  return { ignored, paths: ignored ? tickedItems(IGNORED_PREFIX, found.all, values) : tickedItems(UNTRACKED_PREFIX, found.untracked, values) };
}

export function validateCleanForm(found: CleanCandidates, values: OperationFormValues): OperationFormErrors {
  const ignored = values.scope === 'all';
  return requireTicked(ignored ? IGNORED_PREFIX : UNTRACKED_PREFIX, ignored ? found.all : found.untracked, values, l10n.t('Select at least one file or folder to delete.'));
}

export const SPARSE_PREFIX = 'folder';

export interface SparseState {
  /** The top-level folders of the repository. */
  folders: readonly string[];
  /** The folders checked out now; empty when sparse checkout is off. */
  kept: readonly string[];
}

/** Sparse Checkout: the folders to check out, and when it is on already, a way to check out everything again. */
export function sparseForm(state: SparseState): OperationFormDefinition {
  const on = state.kept.length > 0;
  return {
    title: l10n.t('Sparse Checkout'),
    submitLabel: l10n.t('Apply'),
    values: {
      mode: 'set',
      ...checklistValues(SPARSE_PREFIX, state.folders, (folder) => !on || state.kept.includes(folder)),
    },
    fields: [
      ...(on ? [{
        id: 'mode', type: 'radio' as const, label: l10n.t('Checkout'),
        description: l10n.t('Sparse checkout is on.'),
        options: [
          { value: 'set', label: l10n.t('Check out only these folders') },
          { value: 'disable', label: l10n.t('Check out everything') },
        ],
      }] : []),
      ...checklistFields(SPARSE_PREFIX, state.folders, l10n.t('Folders to check out; the files at the top level are always kept'), on ? { field: 'mode', value: 'set' } : undefined),
    ],
  };
}

export type SparseChoice = { kind: 'disable' } | { kind: 'set'; folders: string[] };

export function sparseChoice(state: SparseState, values: OperationFormValues): SparseChoice {
  return values.mode === 'disable' && state.kept.length > 0
    ? { kind: 'disable' }
    : { kind: 'set', folders: tickedItems(SPARSE_PREFIX, state.folders, values) };
}

export function validateSparseForm(state: SparseState, values: OperationFormValues): OperationFormErrors {
  return sparseChoice(state, values).kind === 'disable'
    ? {} : requireTicked(SPARSE_PREFIX, state.folders, values, l10n.t('Select at least one folder to check out.'));
}
