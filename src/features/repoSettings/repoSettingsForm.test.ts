import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { parseConfigList, repoSettingsChanges, repoSettingsForm } from './repoSettingsForm';

const list = (entries: [scope: string, key: string, value: string][]) =>
  entries.map(([scope, key, value]) => `${scope}\0${key}\n${value}\0`).join('');

describe('repository settings', () => {
  it('reads every scope, keeping this repository apart and letting later values win', () => {
    const config = parseConfigList(list([
      ['system', 'pull.rebase', 'false'], ['global', 'user.name', 'Ada'], ['global', 'pull.rebase', 'true'],
      ['local', 'user.email', 'ada@work.example'], ['local', 'push.autoSetupRemote', 'true'], ['command', 'x.y', '1'],
    ]));
    assert.deepEqual(config.local, { 'user.email': 'ada@work.example', 'push.autosetupremote': 'true' });
    assert.equal(config.inherited['pull.rebase'], 'true');
    assert.equal(config.inherited['user.name'], 'Ada');
    assert.deepEqual(parseConfigList(''), { local: {}, inherited: {} });
  });

  it('shows this repository text values, with the inherited ones as hints, and the values in effect', () => {
    const form = repoSettingsForm({
      local: { 'user.email': 'ada@work.example', 'push.autosetupremote': 'true', 'merge.ff': 'only' },
      inherited: { 'user.name': 'Ada', 'pull.rebase': 'true', 'commit.gpgsign': 'yes' },
    });
    assert.equal(form.values['user.name'], '', 'the global name is not copied into the repository');
    assert.equal(form.fields.find((field) => field.id === 'user.name' && field.type === 'text')?.type, 'text');
    const name = form.fields.find((field) => field.id === 'user.name');
    assert.match(name && 'placeholder' in name ? String(name.placeholder) : '', /Ada/);
    assert.equal(form.values['user.email'], 'ada@work.example');
    assert.equal(form.values['pull.rebase'], 'true');
    assert.equal(form.values['merge.ff'], 'only');
    assert.equal(form.values['push.autoSetupRemote'], true);
    assert.equal(form.values['commit.gpgsign'], true);
    assert.equal(form.values['tag.gpgSign'], false);
    assert.equal(form.values['gpg.format'], 'openpgp');
  });

  it('writes only what changed, and clearing a text value goes back to the inherited one', () => {
    const config = { local: { 'user.email': 'ada@work.example' }, inherited: { 'user.name': 'Ada' } };
    const initial = repoSettingsForm(config).values;
    const changes = repoSettingsChanges(initial, {
      ...initial, 'user.email': '', 'user.name': '  Ada Lovelace ', 'fetch.prune': true, 'merge.ff': 'false',
    }, config);
    assert.deepEqual(changes.set, [['user.name', 'Ada Lovelace'], ['merge.ff', 'false'], ['fetch.prune', 'true']]);
    assert.deepEqual(changes.unset, ['user.email']);
    assert.deepEqual(repoSettingsChanges(initial, initial, config), { set: [], unset: [] });
  });
});
