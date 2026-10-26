import * as l10n from '@vscode/l10n';
import { validateBranchName } from '../branches/branchCreate';

export type GitFlowKind = 'feature' | 'release' | 'hotfix';
export type GitFlowAction = 'init' | 'start' | 'finish' | 'publish';

export interface GitFlowRequest {
  action: GitFlowAction;
  kind?: GitFlowKind;
  name?: string;
  /** For `init`: overrides of the layout to initialize. */
  init?: Partial<GitFlowInitConfig>;
}

export interface GitFlowLayout {
  production: string;
  develop: string;
  featurePrefix: string;
  releasePrefix: string;
  hotfixPrefix: string;
  versionTagPrefix: string;
  remote: string;
}

/** What `git flow init` asks for. */
export type GitFlowInitConfig = Omit<GitFlowLayout, 'remote'>;

export const DEFAULT_GIT_FLOW_LAYOUT: GitFlowLayout = {
  production: 'main',
  develop: 'develop',
  featurePrefix: 'feature/',
  releasePrefix: 'release/',
  hotfixPrefix: 'hotfix/',
  versionTagPrefix: '',
  remote: 'origin',
};

const INIT_FIELDS: readonly (keyof GitFlowInitConfig)[] = [
  'production',
  'develop',
  'featurePrefix',
  'releasePrefix',
  'hotfixPrefix',
  'versionTagPrefix',
];

const ACTIONS: readonly GitFlowAction[] = ['init', 'start', 'finish', 'publish'];
const KINDS: readonly GitFlowKind[] = ['feature', 'release', 'hotfix'];

export function parseGitFlowRequest(value: unknown): GitFlowRequest | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as { action?: unknown; kind?: unknown; name?: unknown; init?: unknown };
  if (!isAction(record.action)) {
    return null;
  }
  if (record.kind !== undefined && !isKind(record.kind)) {
    return null;
  }
  if (record.name !== undefined && typeof record.name !== 'string') {
    return null;
  }
  const request: GitFlowRequest = {
    action: record.action,
    kind: isKind(record.kind) ? record.kind : undefined,
    name: typeof record.name === 'string' ? record.name : undefined,
  };
  const init = parseInitOverrides(record.init);
  if (init) {
    request.init = init;
  }
  return request;
}

function parseInitOverrides(value: unknown): Partial<GitFlowInitConfig> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const overrides: Partial<GitFlowInitConfig> = {};
  for (const field of INIT_FIELDS) {
    if (typeof record[field] === 'string') {
      overrides[field] = record[field];
    }
  }
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

export function validateGitFlowRequest(request: GitFlowRequest): string | null {
  if (request.action === 'init') {
    return null;
  }
  if (!request.kind) {
    return l10n.t('Choose a feature, release, or hotfix flow.');
  }
  const name = request.name?.trim() ?? '';
  if (!name) {
    return l10n.t('A name is required.');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name) || name.includes('..') || name.includes('//')) {
    return l10n.t('Name must start with a letter or digit and contain only letters, digits, and . _ / -');
  }
  return null;
}

export function gitFlowArgs(request: GitFlowRequest): string[] {
  const problem = validateGitFlowRequest(request);
  if (problem) {
    throw new Error(problem);
  }
  if (request.action === 'init') {
    throw new Error('Initializing git-flow does not use the git-flow command.');
  }
  const kind = request.kind;
  const name = request.name?.trim();
  if (!kind || !name) {
    throw new Error(l10n.t('A name is required.'));
  }
  return ['flow', kind, request.action, name];
}

export function parseGitFlowVersion(stdout: string, stderr = ''): string | null {
  const combined = `${stdout}\n${stderr}`;
  if (/not a git command|command not found/i.test(combined)) {
    return null;
  }
  const line = stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find(Boolean);
  if (!line || !/\d/.test(line)) {
    return null;
  }
  return line;
}

export function parseGitFlowConfig(stdout: string): Partial<GitFlowLayout> {
  const layout: Partial<GitFlowLayout> = {};
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const space = trimmed.indexOf(' ');
    if (space <= 0) {
      continue;
    }
    const key = trimmed.slice(0, space);
    const value = trimmed.slice(space + 1).trim();
    if (!value) {
      continue;
    }
    switch (key) {
      case 'gitflow.branch.master':
        layout.production = value;
        break;
      case 'gitflow.branch.develop':
        layout.develop = value;
        break;
      case 'gitflow.prefix.feature':
        layout.featurePrefix = value;
        break;
      case 'gitflow.prefix.release':
        layout.releasePrefix = value;
        break;
      case 'gitflow.prefix.hotfix':
        layout.hotfixPrefix = value;
        break;
      case 'gitflow.prefix.versiontag':
        layout.versionTagPrefix = value;
        break;
      default:
        break;
    }
  }
  return layout;
}

export function resolveGitFlowLayout(
  config: Partial<GitFlowLayout>,
  headNames: readonly string[],
): GitFlowLayout {
  const production =
    config.production ??
    (headNames.includes('main') ? 'main' : headNames.includes('master') ? 'master' : 'main');
  return {
    ...DEFAULT_GIT_FLOW_LAYOUT,
    ...config,
    production,
  };
}

export function fallbackGitCommands(
  request: GitFlowRequest,
  layout: GitFlowLayout = DEFAULT_GIT_FLOW_LAYOUT,
): string[] {
  const problem = validateGitFlowRequest(request);
  if (problem) {
    throw new Error(problem);
  }
  if (request.action === 'init') {
    throw new Error('Initializing git-flow does not use the git-flow command.');
  }
  const kind = request.kind;
  const name = request.name?.trim();
  if (!kind || !name) {
    throw new Error(l10n.t('A name is required.'));
  }
  const prefix = prefixFor(kind, layout);
  const branch = `${prefix}${name}`;
  switch (request.action) {
    case 'start':
      if (kind === 'hotfix') {
        return [`git checkout ${layout.production}`, `git checkout -b ${branch}`];
      }
      return [`git checkout ${layout.develop}`, `git checkout -b ${branch}`];
    case 'publish':
      return [`git checkout ${branch}`, `git push -u ${layout.remote} ${branch}`];
    case 'finish':
      if (kind === 'feature') {
        return [
          `git checkout ${layout.develop}`,
          `git merge --no-ff ${branch}`,
          `git branch -d ${branch}`,
        ];
      }
      return [
        `git checkout ${layout.production}`,
        `git merge --no-ff ${branch}`,
        `git tag -a ${name} -m ${name}`,
        `git checkout ${layout.develop}`,
        `git merge --no-ff ${branch}`,
        `git branch -d ${branch}`,
      ];
  }
}

export function formatGitFlowFallback(commands: readonly string[]): string {
  return [
    l10n.t('git-flow is not installed on this machine. Equivalent commands were not run.'),
    l10n.t('Install git-flow on the workspace host, or run these commands yourself:'),
    ...commands.map((line) => `  ${line}`),
    l10n.t('Branch names assume the usual git-flow layout. Change them if this repository uses different names.'),
    l10n.t('Annotated tags from release and hotfix finish honor tag.gpgSign.'),
  ].join('\n');
}

function prefixFor(kind: GitFlowKind, layout: GitFlowLayout): string {
  switch (kind) {
    case 'feature':
      return layout.featurePrefix;
    case 'release':
      return layout.releasePrefix;
    case 'hotfix':
      return layout.hotfixPrefix;
  }
}

function isAction(value: unknown): value is GitFlowAction {
  return typeof value === 'string' && ACTIONS.includes(value as GitFlowAction);
}

function isKind(value: unknown): value is GitFlowKind {
  return typeof value === 'string' && KINDS.includes(value as GitFlowKind);
}

/** True once `gitflow.branch.master` and `gitflow.branch.develop` are both configured. */
export function isGitFlowInitialized(config: Partial<GitFlowLayout>): boolean {
  return Boolean(config.production && config.develop);
}

export function gitFlowInitDefaults(config: Partial<GitFlowLayout>, headNames: readonly string[]): GitFlowInitConfig {
  const { remote: _remote, ...init } = resolveGitFlowLayout(config, headNames);
  return init;
}

/** Field errors for an init form; `branchNames` are the local branches. */
export function validateGitFlowInit(
  config: GitFlowInitConfig,
  branchNames: readonly string[],
): Record<string, string> {
  const errors: Record<string, string> = {};
  const production = config.production.trim();
  const develop = config.develop.trim();
  const productionProblem = validateBranchName(production);
  if (productionProblem) {
    errors.production = productionProblem;
  } else if (!branchNames.includes(production)) {
    errors.production = l10n.t('Branch {0} does not exist. Create it or choose another.', production);
  }
  const developProblem = validateBranchName(develop);
  if (developProblem) {
    errors.develop = developProblem;
  } else if (develop === production) {
    errors.develop = l10n.t('The development branch must differ from the production branch.');
  }
  for (const field of ['featurePrefix', 'releasePrefix', 'hotfixPrefix'] as const) {
    const problem = validatePrefix(config[field], true);
    if (problem) {
      errors[field] = problem;
    }
  }
  const tagProblem = validatePrefix(config.versionTagPrefix, false);
  if (tagProblem) {
    errors.versionTagPrefix = tagProblem;
  }
  const prefixes = [config.featurePrefix, config.releasePrefix, config.hotfixPrefix].map((entry) => entry.trim());
  if (!errors.releasePrefix && !errors.hotfixPrefix && !errors.featurePrefix && new Set(prefixes).size < 3) {
    errors.releasePrefix = l10n.t('Use a different prefix for each kind of branch.');
  }
  return errors;
}

function validatePrefix(value: string, required: boolean): string | undefined {
  const prefix = value.trim();
  if (!prefix) {
    return required ? l10n.t('A prefix is required.') : undefined;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(prefix) || prefix.includes('..') || prefix.includes('//')) {
    return l10n.t('Use letters, digits, and . _ / - only, starting with a letter or digit.');
  }
  return undefined;
}

/** Git commands (argv) that initialize git-flow: develop from production, config, then switch to develop. */
export function gitFlowInitSteps(config: GitFlowInitConfig, developExists: boolean): string[][] {
  const production = config.production.trim();
  const develop = config.develop.trim();
  return [
    ...(developExists ? [] : [['branch', develop, production]]),
    ['config', 'gitflow.branch.master', production],
    ['config', 'gitflow.branch.develop', develop],
    ['config', 'gitflow.prefix.feature', config.featurePrefix.trim()],
    ['config', 'gitflow.prefix.release', config.releasePrefix.trim()],
    ['config', 'gitflow.prefix.hotfix', config.hotfixPrefix.trim()],
    ['config', 'gitflow.prefix.versiontag', config.versionTagPrefix.trim()],
    ['checkout', develop],
  ];
}
