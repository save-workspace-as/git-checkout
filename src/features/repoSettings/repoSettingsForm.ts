import * as l10n from '@vscode/l10n';
import type { OperationFormDefinition, OperationFormValues } from '../../shared/forms/operationForm';

/** Git configuration as Git reports it: every scope's value of each key, the last one winning. */
export interface GitConfigValues {
  /** Values set for this repository (`git config --local`). */
  local: Record<string, string>;
  /** Values from every other scope (system, global), what the repository uses when it sets none. */
  inherited: Record<string, string>;
}

type Setting =
  | { key: string; kind: 'text'; label: string; description: string; pickLabel?: string }
  | { key: string; kind: 'checkbox'; label: string; description: string; fallback: boolean }
  | { key: string; kind: 'radio'; label: string; description: string; fallback: string; options: { value: string; label: string }[] };

/** The settings the form offers, in its order. Every one is Git's own; nothing is kept by the extension. */
export function repoSettings(): Setting[] {
  const emptyMeansGlobal = l10n.t('Leave empty to use the value from your global configuration.');
  return [
    { key: 'user.name', kind: 'text', label: l10n.t('Author name'), description: l10n.t('The name recorded on commits in this repository. {0}', emptyMeansGlobal) },
    { key: 'user.email', kind: 'text', label: l10n.t('Author email'), description: l10n.t('The email recorded on commits in this repository. {0}', emptyMeansGlobal) },
    {
      key: 'commit.template', kind: 'text', label: l10n.t('Commit message template file'), pickLabel: l10n.t('Browse…'),
      description: l10n.t('The file used as the starting commit message. {0}', emptyMeansGlobal),
    },
    {
      key: 'pull.rebase', kind: 'radio', label: l10n.t('Pull'), fallback: 'false',
      description: l10n.t('How the commits you pull are combined with your branch.'),
      options: [{ value: 'false', label: l10n.t('Merge') }, { value: 'true', label: l10n.t('Rebase') }],
    },
    {
      key: 'merge.ff', kind: 'radio', label: l10n.t('Merge'), fallback: 'true',
      description: l10n.t('When a merge is allowed to fast-forward.'),
      options: [
        { value: 'true', label: l10n.t('Fast-forward when possible') },
        { value: 'false', label: l10n.t('Always create a merge commit') },
        { value: 'only', label: l10n.t('Only fast-forward') },
      ],
    },
    {
      key: 'fetch.prune', kind: 'checkbox', label: l10n.t('Prune on fetch'), fallback: false,
      description: l10n.t('Remove remote-tracking branches that are gone when fetching.'),
    },
    {
      key: 'push.autoSetupRemote', kind: 'checkbox', label: l10n.t('Set upstream on push'), fallback: false,
      description: l10n.t('Set the upstream branch the first time you push.'),
    },
    {
      key: 'commit.gpgsign', kind: 'checkbox', label: l10n.t('Sign commits'), fallback: false,
      description: l10n.t('Sign every commit with your signing key.'),
    },
    {
      key: 'tag.gpgSign', kind: 'checkbox', label: l10n.t('Sign tags'), fallback: false,
      description: l10n.t('Sign annotated tags with your signing key.'),
    },
    {
      key: 'user.signingkey', kind: 'text', label: l10n.t('Signing key'),
      description: l10n.t('The key used to sign commits and tags. {0}', emptyMeansGlobal),
    },
    {
      key: 'gpg.format', kind: 'radio', label: l10n.t('Signature format'), fallback: 'openpgp',
      description: l10n.t('The format of the signatures that are written.'),
      options: [{ value: 'openpgp', label: 'OpenPGP' }, { value: 'ssh', label: 'SSH' }, { value: 'x509', label: 'X.509' }],
    },
  ];
}

/** Git reads `true`, `yes`, `on` and `1` as true, and the key on its own (empty value) as true too. */
function gitBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return ['true', 'yes', 'on', '1', ''].includes(value.trim().toLowerCase());
}

/** Git lists keys in lower case, so look them up that way. */
const localValue = (config: GitConfigValues, key: string): string | undefined => config.local[key.toLowerCase()];
const effective = (config: GitConfigValues, key: string): string | undefined =>
  config.local[key.toLowerCase()] ?? config.inherited[key.toLowerCase()];

/**
 * The Repository Settings form. A text field holds this repository's own value and is empty when it has
 * none, showing the inherited value as its placeholder; clearing it goes back to that value. Checkboxes
 * and choices show the value in effect.
 */
export function repoSettingsForm(config: GitConfigValues): OperationFormDefinition {
  const values: OperationFormValues = {};
  const fields: OperationFormDefinition['fields'] = repoSettings().map((setting) => {
    if (setting.kind === 'text') {
      values[setting.key] = localValue(config, setting.key) ?? '';
      const inherited = config.inherited[setting.key.toLowerCase()];
      return {
        id: setting.key, type: 'text', label: setting.label, description: setting.description,
        placeholder: inherited ? l10n.t('{0} (from your global configuration)', inherited) : l10n.t('Not set'),
        ...(setting.pickLabel ? { pickLabel: setting.pickLabel } : {}),
      };
    }
    if (setting.kind === 'checkbox') {
      values[setting.key] = gitBoolean(effective(config, setting.key), setting.fallback);
      return { id: setting.key, type: 'checkbox', label: setting.label, description: setting.description };
    }
    const current = effective(config, setting.key)?.trim().toLowerCase();
    values[setting.key] = setting.options.some((option) => option.value === current) ? current as string : setting.fallback;
    return { id: setting.key, type: 'radio', label: setting.label, description: setting.description, options: setting.options };
  });
  return {
    title: l10n.t('Repository Settings'),
    submitLabel: l10n.t('Save'),
    values,
    fields,
    tabs: [
      { label: l10n.t('General'), fields: ['user.name', 'user.email', 'commit.template'] },
      { label: l10n.t('Pull and Push'), fields: ['pull.rebase', 'merge.ff', 'fetch.prune', 'push.autoSetupRemote'] },
      { label: l10n.t('Signing'), fields: ['commit.gpgsign', 'tag.gpgSign', 'user.signingkey', 'gpg.format'] },
    ],
  };
}

export interface GitConfigChanges {
  set: [key: string, value: string][];
  unset: string[];
}

/** What to write for the submitted form: only the settings that changed, so nothing else gets a local value. */
export function repoSettingsChanges(initial: OperationFormValues, submitted: OperationFormValues, config: GitConfigValues): GitConfigChanges {
  const changes: GitConfigChanges = { set: [], unset: [] };
  for (const setting of repoSettings()) {
    const before = initial[setting.key];
    const after = submitted[setting.key];
    if (after === undefined || after === before) {
      continue;
    }
    if (setting.kind === 'text') {
      const text = String(after).trim();
      if (text) {
        changes.set.push([setting.key, text]);
      } else if (localValue(config, setting.key) !== undefined) {
        changes.unset.push(setting.key);
      }
      continue;
    }
    changes.set.push([setting.key, String(after)]);
  }
  return changes;
}

/** Reads `git config --list --show-scope -z`: `scope NUL key LF value NUL`, one entry after another. */
export function parseConfigList(output: string): GitConfigValues {
  const config: GitConfigValues = { local: {}, inherited: {} };
  const parts = output.split('\0');
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const scope = parts[i];
    const entry = parts[i + 1];
    const newline = entry.indexOf('\n');
    const key = (newline >= 0 ? entry.slice(0, newline) : entry).toLowerCase();
    const value = newline >= 0 ? entry.slice(newline + 1) : '';
    if (!key) {
      continue;
    }
    // Later entries win, as they do for Git; keys are matched without case, as Git does.
    (scope === 'local' || scope === 'worktree' ? config.local : config.inherited)[key] = value;
  }
  return config;
}
