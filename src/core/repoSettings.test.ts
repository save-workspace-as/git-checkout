import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  applyRepoGraphOverrides,
  configValueToWrite,
  findRepoSetting,
  formatRepoSettingValue,
  parseGitConfigAssignments,
  parseGitConfigPairs,
  REPO_SETTINGS,
  repoSettingEditChoices,
  repoSettingResultLabel,
  stringSettingEdit,
  type GraphDisplay,
} from './repoSettings';

const BASE: GraphDisplay = {
  order: 'date',
  gravatar: false,
  activeBranchOnly: false,
  collapseMerges: false,
  showReflog: false,
  showStashes: true,
  showRemoteBranches: true,
  showTags: true,
};

describe('repository settings catalog', () => {
  it('maps each setting to a distinct local git config key', () => {
    const keys = REPO_SETTINGS.map((setting) => setting.gitKey);
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(keys.includes('gitcheckout.graph.order'));
    assert.equal(findRepoSetting('graph.activeBranchOnly')?.label, 'Show active branch');
    assert.ok(keys.includes('commit.gpgsign'));
    assert.ok(keys.includes('user.email'));
  });

  it('formats stored values for the settings list', () => {
    const order = findRepoSetting('graph.order');
    const signing = findRepoSetting('commit.gpgsign');
    const name = findRepoSetting('user.name');
    assert.ok(order && signing && name);
    assert.equal(formatRepoSettingValue(order, null), 'not set');
    assert.equal(formatRepoSettingValue(order, 'topo'), 'Topology');
    assert.equal(formatRepoSettingValue(signing, 'yes'), 'on');
    assert.equal(formatRepoSettingValue(signing, '0'), 'off');
    assert.equal(formatRepoSettingValue(name, 'Ada Lovelace'), 'Ada Lovelace');
  });

  it('offers on, off, and unset for boolean settings', () => {
    const signing = findRepoSetting('commit.gpgsign');
    assert.ok(signing);
    const choices = repoSettingEditChoices(signing, 'true');
    assert.deepEqual(
      choices.map((choice) => choice.edit),
      [{ action: 'set', value: 'true' }, { action: 'set', value: 'false' }, { action: 'unset' }],
    );
    assert.equal(choices[0].description, 'current');
  });

  it('treats a blank string prompt as clearing the local value', () => {
    assert.equal(stringSettingEdit(undefined), undefined);
    assert.deepEqual(stringSettingEdit('  '), { action: 'unset' });
    assert.deepEqual(stringSettingEdit(' Ada '), { action: 'set', value: 'Ada' });
  });

  it('rejects values git would treat as options', () => {
    const name = findRepoSetting('user.name');
    const order = findRepoSetting('graph.order');
    assert.ok(name && order);
    assert.equal(configValueToWrite(name, '--unset'), null);
    assert.equal(configValueToWrite(name, 'Ada'), 'Ada');
    assert.equal(configValueToWrite(order, 'date'), 'date');
    assert.equal(configValueToWrite(order, 'author'), null);
  });
});

describe('git config parsers', () => {
  it('parses local list and regexp output', () => {
    const listed = parseGitConfigAssignments('user.name=Ada Lovelace\nuser.email=ada@example.com\n');
    assert.equal(listed.get('user.name'), 'Ada Lovelace');
    const pairs = parseGitConfigPairs('gitcheckout.graph.order topo\ngitcheckout.graph.gravatar true\n');
    assert.equal(pairs.get('gitcheckout.graph.order'), 'topo');
    assert.equal(pairs.get('gitcheckout.graph.gravatar'), 'true');
  });

  it('applies valid repository graph overrides and ignores the rest', () => {
    const local = parseGitConfigPairs(
      [
        'gitcheckout.graph.order topo',
        'gitcheckout.graph.gravatar yes',
        'gitcheckout.graph.activeBranchOnly true',
        'gitcheckout.graph.collapseMerges maybe',
        'gitcheckout.graph.showReflog false',
        'gitcheckout.graph.showStashes false',
        'gitcheckout.graph.showRemoteBranches off',
        'gitcheckout.graph.showTags nope',
      ].join('\n'),
    );
    assert.deepEqual(applyRepoGraphOverrides({ ...BASE, collapseMerges: true }, local), {
      order: 'topo',
      gravatar: true,
      activeBranchOnly: true,
      collapseMerges: true,
      showReflog: false,
      showStashes: false,
      showRemoteBranches: false,
      showTags: true,
    });
    assert.deepEqual(applyRepoGraphOverrides(BASE, new Map()), BASE);
  });

  it('describes the value that was saved', () => {
    const order = findRepoSetting('graph.order');
    assert.ok(order);
    assert.equal(
      repoSettingResultLabel(order, { action: 'set', value: 'date' }),
      'Graph order is Date for this repository.',
    );
    assert.equal(
      repoSettingResultLabel(order, { action: 'unset' }),
      'Graph order is not set for this repository.',
    );
  });
});
