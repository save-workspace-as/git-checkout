import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import {
  executeBranchCreate,
  parseBranchCreateArg,
  validateBranchName,
  validateStartPoint,
} from './branchCreate';
import type { GitCli } from '../../core/gitCli';
import {
  branchNameInput,
  parseBranchNameSeparator,
  parseBranchWhitespaceReplacement,
  replaceBranchWhitespace,
  type BranchNameSeparator,
} from '../../shared/branches/branchCreate';
import type { OperationFormDefinition, OperationFormErrors, OperationFormValues } from '../../shared/forms/operationForm';
import type { ShowOperationForm } from '../../panel/operationFormController';
import { listOperationRefs } from './operationFormRefs';

export interface BranchCreatePromptContext {
  currentBranch: string | null;
  startRef: string;
  separator: BranchNameSeparator;
  /** Put in place of whitespace typed into the name; VS Code's `git.branchWhitespaceChar`. */
  whitespaceReplacement?: string;
  /** Whether "Checkout after creating" starts checked; on unless the person's last choice is remembered as off. */
  checkout?: boolean;
}

const REMEMBERED_CHECKOUT_KEY = 'gitCheckout.branchCreate.checkout';
let rememberedCheckout: vscode.Memento | undefined;

/** Where the last "Checkout after creating" choice is kept between sessions; set once on activation. */
export function rememberBranchCheckoutIn(state: vscode.Memento): void {
  rememberedCheckout = state;
}

/** The "Checkout after creating" choice to start with: the last one when `gitCheckout.branch.rememberCheckout` is on. */
export function initialBranchCheckout(): boolean {
  const remember = vscode.workspace.getConfiguration('gitCheckout').get<boolean>('branch.rememberCheckout', true);
  return remember ? rememberedCheckout?.get<boolean>(REMEMBERED_CHECKOUT_KEY, true) ?? true : true;
}

export function readBranchWhitespaceReplacement(): string {
  return parseBranchWhitespaceReplacement(
    vscode.workspace.getConfiguration('git').get('branchWhitespaceChar', '-'),
  );
}

export function readBranchNameSeparator(): BranchNameSeparator {
  return parseBranchNameSeparator(
    vscode.workspace.getConfiguration('gitCheckout').get('branch.nameSeparator'),
  );
}

export function branchCreateForm(
  context: BranchCreatePromptContext, refs: readonly string[] = [context.startRef, 'HEAD'],
): OperationFormDefinition {
  return {
    title: l10n.t('Create Branch'),
    submitLabel: l10n.t('Create Branch'),
    checkedSubmitLabel: { field: 'checkout', label: l10n.t('Create and Checkout') },
    values: {
      name: branchNameInput(context.currentBranch, context.separator).value,
      startPoint: context.startRef,
      checkout: context.checkout ?? true,
      localChanges: 'keep',
    },
    fields: [
      {
        id: 'name', type: 'text', label: l10n.t('Branch name'), required: true,
        description: l10n.t('The name of the new branch.'),
        placeholder: l10n.t('Enter branch name'), replaceWhitespace: context.whitespaceReplacement ?? '-',
      },
      {
        id: 'startPoint', type: 'text', label: l10n.t('Start point'),
        description: l10n.t('The revision the new branch starts from.'),
        placeholder: 'HEAD', suggestions: refs.map((value) => ({ value })),
      },
      {
        id: 'checkout', type: 'checkbox', label: l10n.t('Checkout'),
        description: l10n.t('Checkout the new branch after creating it.'),
      },
      {
        id: 'localChanges', type: 'radio', label: l10n.t('Local changes'),
        options: [
          { value: 'keep', label: l10n.t('Keep') },
          { value: 'stash', label: l10n.t('Stash and reapply') },
          { value: 'discard', label: l10n.t('Discard') },
        ],
      },
    ],
  };
}

export function validateBranchCreateForm(values: OperationFormValues): OperationFormErrors {
  const errors: OperationFormErrors = {};
  const name = typeof values.name === 'string' ? validateBranchName(values.name) : l10n.t('Name is required');
  const start = typeof values.startPoint === 'string' ? validateStartPoint(values.startPoint) : l10n.t('Enter a start point');
  if (name) {
    errors.name = name;
  }
  if (start) {
    errors.startPoint = start;
  }
  return errors;
}

export async function createBranchInForm(
  showOperationForm: ShowOperationForm,
  cli: GitCli,
  context: BranchCreatePromptContext,
): Promise<boolean> {
  const refs = await listOperationRefs(cli, context.startRef);
  return showOperationForm(branchCreateForm(context, refs), {
    validate: validateBranchCreateForm,
    async submit(values): Promise<boolean> {
      // A name pasted past the field's own replacement gets the same treatment.
      const replacement = context.whitespaceReplacement ?? '-';
      const parsed = parseBranchCreateArg(
        typeof values.name === 'string' ? { ...values, name: replaceBranchWhitespace(values.name, replacement) } : values,
      );
      if (parsed.status !== 'ready') {
        throw new Error(parsed.status === 'invalid' ? parsed.message : l10n.t('Invalid branch request.'));
      }
      if (parsed.request.localChanges === 'discard' && !(await confirmDiscardLocalChanges())) {
        return false;
      }
      await executeBranchCreate(cli, parsed.request);
      void rememberedCheckout?.update(REMEMBERED_CHECKOUT_KEY, values.checkout === true);
      return true;
    },
  });
}

async function confirmDiscardLocalChanges(): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(
    l10n.t('Discard uncommitted changes? This is difficult to undo.'),
    { modal: true },
    l10n.t('Discard'),
  );
  return choice === l10n.t('Discard');
}
