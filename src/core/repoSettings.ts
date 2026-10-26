import * as l10n from '@vscode/l10n';
import type { GraphOrder } from '../shared/graph/graphProtocol';

export type RepoSettingKind = 'boolean' | 'choice' | 'string';

export interface RepoSettingChoice {
  value: string;
  label: string;
}

export interface RepoSettingDefinition {
  id: string;
  label: string;
  /** Git config key written with `git config --local`. */
  gitKey: string;
  kind: RepoSettingKind;
  choices?: readonly RepoSettingChoice[];
}

export const REPO_GRAPH_CONFIG_REGEXP = '^gitcheckout\\.graph\\.';

export const REPO_SETTINGS: readonly RepoSettingDefinition[] = [
  {
    id: 'graph.order',
    label: l10n.t('Graph order'),
    gitKey: 'gitcheckout.graph.order',
    kind: 'choice',
    choices: [
      { value: 'date', label: l10n.t('Date') },
      { value: 'topo', label: l10n.t('Topology') },
    ],
  },
  {
    id: 'graph.gravatar',
    label: l10n.t('Gravatar avatars'),
    gitKey: 'gitcheckout.graph.gravatar',
    kind: 'boolean',
  },
  {
    id: 'graph.activeBranchOnly',
    label: l10n.t('Show active branch'),
    gitKey: 'gitcheckout.graph.activeBranchOnly',
    kind: 'boolean',
  },
  {
    id: 'graph.collapseMerges',
    label: l10n.t('Collapse merge commits'),
    gitKey: 'gitcheckout.graph.collapseMerges',
    kind: 'boolean',
  },
  {
    id: 'graph.showReflog',
    label: l10n.t('Show reflog'),
    gitKey: 'gitcheckout.graph.showReflog',
    kind: 'boolean',
  },
  {
    id: 'graph.showStashes',
    label: l10n.t('Show stashes'),
    gitKey: 'gitcheckout.graph.showStashes',
    kind: 'boolean',
  },
  {
    id: 'graph.showRemoteBranches',
    label: l10n.t('Show remote branches'),
    gitKey: 'gitcheckout.graph.showRemoteBranches',
    kind: 'boolean',
  },
  {
    id: 'graph.showTags',
    label: l10n.t('Show tags'),
    gitKey: 'gitcheckout.graph.showTags',
    kind: 'boolean',
  },
  {
    id: 'commit.gpgsign',
    label: l10n.t('Commit signing'),
    gitKey: 'commit.gpgsign',
    kind: 'boolean',
  },
  {
    id: 'tag.gpgSign',
    label: l10n.t('Tag signing'),
    gitKey: 'tag.gpgSign',
    kind: 'boolean',
  },
  {
    id: 'user.name',
    label: l10n.t('User name'),
    gitKey: 'user.name',
    kind: 'string',
  },
  {
    id: 'user.email',
    label: l10n.t('User email'),
    gitKey: 'user.email',
    kind: 'string',
  },
];

export interface RepoSettingEdit {
  action: 'set' | 'unset';
  value?: string;
}

export interface GraphDisplay {
  order: GraphOrder;
  gravatar: boolean;
  activeBranchOnly: boolean;
  collapseMerges: boolean;
  showReflog: boolean;
  showStashes: boolean;
  showRemoteBranches: boolean;
  showTags: boolean;
}

export function findRepoSetting(id: string): RepoSettingDefinition | undefined {
  return REPO_SETTINGS.find((setting) => setting.id === id);
}

/** `git config --list` lines (`key=value`). Later duplicates win. */
export function parseGitConfigAssignments(stdout: string): Map<string, string> {
  return parseGitConfigLines(stdout, '=');
}

/** `git config --get-regexp` lines (`key value`). Later duplicates win. */
export function parseGitConfigPairs(stdout: string): Map<string, string> {
  return parseGitConfigLines(stdout, ' ');
}

export function parseGitConfigBoolean(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  return null;
}

export function formatRepoSettingValue(definition: RepoSettingDefinition, raw: string | null): string {
  if (raw === null || raw.trim() === '') {
    return l10n.t('not set');
  }
  const trimmed = raw.trim();
  if (definition.kind === 'boolean') {
    const parsed = parseGitConfigBoolean(trimmed);
    if (parsed === true) {
      return l10n.t('on');
    }
    if (parsed === false) {
      return l10n.t('off');
    }
    return trimmed;
  }
  if (definition.kind === 'choice') {
    return definition.choices?.find((choice) => choice.value === trimmed)?.label ?? trimmed;
  }
  return trimmed;
}

export interface RepoSettingEditChoice {
  label: string;
  description?: string;
  edit: RepoSettingEdit;
}

export function repoSettingEditChoices(
  definition: RepoSettingDefinition,
  raw: string | null,
): RepoSettingEditChoice[] {
  const current = raw?.trim() ?? '';
  if (definition.kind === 'boolean') {
    const parsed = current ? parseGitConfigBoolean(current) : null;
    return [
      { label: l10n.t('On'), description: parsed === true ? l10n.t('current') : undefined, edit: { action: 'set', value: 'true' } },
      { label: l10n.t('Off'), description: parsed === false ? l10n.t('current') : undefined, edit: { action: 'set', value: 'false' } },
      { label: l10n.t('Not set'), description: l10n.t('Remove the local value'), edit: { action: 'unset' } },
    ];
  }
  if (definition.kind === 'choice') {
    const choices: RepoSettingEditChoice[] = (definition.choices ?? []).map((choice) => ({
      label: choice.label,
      description: choice.value === current ? l10n.t('current') : undefined,
      edit: { action: 'set', value: choice.value },
    }));
    choices.push({
      label: l10n.t('Not set'),
      description: l10n.t('Remove the local value'),
      edit: { action: 'unset' },
    });
    return choices;
  }
  return [];
}

/** Empty input clears the local value. `undefined` means the prompt was cancelled. */
export function stringSettingEdit(input: string | undefined): RepoSettingEdit | undefined {
  if (input === undefined) {
    return undefined;
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return { action: 'unset' };
  }
  return { action: 'set', value: trimmed };
}

/** Value safe to pass as a `git config` argument, or null when it should be rejected. */
export function configValueToWrite(definition: RepoSettingDefinition, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('-') || /[\n\r\0]/.test(trimmed)) {
    return null;
  }
  if (definition.kind === 'boolean') {
    return trimmed === 'true' || trimmed === 'false' ? trimmed : null;
  }
  if (definition.kind === 'choice') {
    return definition.choices?.some((choice) => choice.value === trimmed) ? trimmed : null;
  }
  return trimmed;
}

export function applyRepoGraphOverrides(
  base: GraphDisplay,
  local: ReadonlyMap<string, string>,
): GraphDisplay {
  const next: GraphDisplay = { ...base };
  const order = local.get('gitcheckout.graph.order');
  if (order === 'date' || order === 'topo') {
    next.order = order;
  }
  assignBoolean(next, 'gravatar', local.get('gitcheckout.graph.gravatar'));
  assignBoolean(next, 'activeBranchOnly', local.get('gitcheckout.graph.activebranchonly'));
  assignBoolean(next, 'collapseMerges', local.get('gitcheckout.graph.collapsemerges'));
  assignBoolean(next, 'showReflog', local.get('gitcheckout.graph.showreflog'));
  assignBoolean(next, 'showStashes', local.get('gitcheckout.graph.showstashes'));
  assignBoolean(next, 'showRemoteBranches', local.get('gitcheckout.graph.showremotebranches'));
  assignBoolean(next, 'showTags', local.get('gitcheckout.graph.showtags'));
  return next;
}

export function repoSettingResultLabel(definition: RepoSettingDefinition, edit: RepoSettingEdit): string {
  if (edit.action === 'unset') {
    return l10n.t('{0} is not set for this repository.', definition.label);
  }
  return l10n.t(
    '{0} is {1} for this repository.',
    definition.label,
    formatRepoSettingValue(definition, edit.value ?? null),
  );
}

function assignBoolean(
  display: GraphDisplay,
  field: Exclude<keyof GraphDisplay, 'order'>,
  raw: string | undefined,
): void {
  if (raw === undefined) {
    return;
  }
  const parsed = parseGitConfigBoolean(raw);
  if (parsed !== null) {
    display[field] = parsed;
  }
}

function parseGitConfigLines(stdout: string, separator: '=' | ' '): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of stdout.split(/\r?\n/)) {
    const index = line.indexOf(separator);
    if (index <= 0) {
      continue;
    }
    map.set(line.slice(0, index).trim().toLowerCase(), line.slice(index + 1));
  }
  return map;
}
