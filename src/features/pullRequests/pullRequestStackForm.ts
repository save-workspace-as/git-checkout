import * as l10n from '@vscode/l10n';
import type { OperationFormDefinition, OperationFormErrors, OperationFormField, OperationFormValues } from '../../shared/forms/operationForm';
import { defaultEnds, layerBody, layerBranchName, layersOf, type StackCommit } from '../../shared/pullRequests/stackLayers';
import { validateBranchName } from '../branches/branchCreate';

/** What the form is made from: a branch, what it merges into, and its commits (oldest first). */
export interface StackFormContext {
  branch: string;
  /** The branch the bottom pull request merges into, as GitHub names it. */
  baseName: string;
  commits: readonly StackCommit[];
  /** Every local branch, so a layer is never given the name of one that exists. */
  existingBranches: ReadonlySet<string>;
}

/** A pull request to make: the branch it is from (made at `sha` when it is new), what it merges into, and its text. */
export interface StackPlanLayer {
  branch: string;
  sha: string;
  created: boolean;
  base: string;
  title: string;
  body: string;
}

export interface StackPlan {
  layers: StackPlanLayer[];
  draft: boolean;
  link: boolean;
}

const endId = (index: number): string => `end-${index}`;
const branchId = (index: number): string => `branch-${index}`;
const titleId = (index: number): string => `title-${index}`;
const short = (commit: StackCommit): string => commit.sha.slice(0, 7);

/** The form's fields for one commit, newest first: whether it ends a pull request, and that pull request's branch and title. */
function rowOf(context: StackFormContext, index: number): OperationFormField[] {
  const commit = context.commits[index];
  const newest = index === context.commits.length - 1;
  const when = newest ? undefined : { field: endId(index), value: true };
  return [
    ...(newest ? [] : [{
      id: endId(index), type: 'checkbox' as const, label: short(commit), description: commit.subject,
    }]),
    {
      id: branchId(index), type: 'text', label: l10n.t('Branch'), when, required: true,
      readOnly: newest || commit.branches.length > 0,
      description: newest ? l10n.t('The newest commit ends the top pull request, from the branch itself.') : undefined,
    },
    { id: titleId(index), type: 'text', label: l10n.t('Title'), when, required: true },
  ];
}

export function stackForm(context: StackFormContext): OperationFormDefinition {
  const { commits } = context;
  const ends = defaultEnds(commits);
  const taken = new Set(context.existingBranches);
  const values: OperationFormValues = { draft: 'draft', link: true };
  commits.forEach((commit, index) => {
    const newest = index === commits.length - 1;
    const existing = commit.branches[0];
    const branch = newest ? context.branch : existing ?? layerBranchName(context.branch, commit.subject, taken);
    taken.add(branch);
    values[endId(index)] = !newest && ends.has(commit.sha);
    values[branchId(index)] = branch;
    values[titleId(index)] = commit.subject;
  });
  const rows = commits.map((_, index) => commits.length - 1 - index).flatMap((index) => rowOf(context, index));
  return {
    title: l10n.t('Create Pull Request Stack'),
    submitLabel: l10n.t('Create Stack'),
    values,
    fields: [
      ...rows,
      {
        id: 'draft', type: 'radio', label: l10n.t('Pull requests'),
        description: l10n.t('Tick the commits that end a pull request. The commits between two of them join the upper one.'),
        options: [{ value: 'draft', label: l10n.t('Draft') }, { value: 'ready', label: l10n.t('Ready for review') }],
      },
      { id: 'link', type: 'checkbox', label: l10n.t('Stack'), description: l10n.t('Group the pull requests as a stack on GitHub') },
    ],
  };
}

/** The pull requests the filled-in form asks for, bottom first. */
export function stackPlanFromValues(context: StackFormContext, values: OperationFormValues): StackPlan {
  const ends = new Set(context.commits.filter((_, index) => values[endId(index)] === true).map((commit) => commit.sha));
  let base = context.baseName;
  const layers = layersOf(context.commits, ends).map((layer): StackPlanLayer => {
    const index = context.commits.indexOf(layer.head);
    const branch = String(values[branchId(index)] ?? '').trim();
    const planned: StackPlanLayer = {
      branch,
      sha: layer.head.sha,
      created: index !== context.commits.length - 1 && layer.head.branches.length === 0,
      base,
      title: String(values[titleId(index)] ?? '').trim(),
      body: layerBody(layer),
    };
    base = branch;
    return planned;
  });
  return { layers, draft: values.draft !== 'ready', link: values.link === true };
}

/** What is wrong with the pull requests the form asks for: a branch name that is not usable, or used twice. */
export function validateStackForm(context: StackFormContext, values: OperationFormValues): OperationFormErrors {
  const errors: OperationFormErrors = {};
  const seen = new Set<string>();
  for (const layer of stackPlanFromValues(context, values).layers) {
    const index = context.commits.findIndex((commit) => commit.sha === layer.sha);
    const id = branchId(index);
    const problem = layer.created ? validateBranchName(layer.branch) : undefined;
    if (problem) {
      errors[id] = problem;
    } else if (seen.has(layer.branch)) {
      errors[id] = l10n.t('Another pull request already uses this branch.');
    } else if (layer.created && context.existingBranches.has(layer.branch)) {
      errors[id] = l10n.t('A branch with this name exists.');
    }
    seen.add(layer.branch);
  }
  return errors;
}
