import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  DEFAULT_GIT_FLOW_LAYOUT,
  fallbackGitCommands,
  formatGitFlowFallback,
  gitFlowArgs,
  parseGitFlowConfig,
  parseGitFlowRequest,
  parseGitFlowVersion,
  gitFlowInitDefaults,
  gitFlowInitSteps,
  isGitFlowInitialized,
  resolveGitFlowLayout,
  validateGitFlowInit,
  validateGitFlowRequest,
} from './gitFlowGuide';

const feature = { action: 'start' as const, kind: 'feature' as const, name: 'widget' };

describe('parseGitFlowRequest', () => {
  it('accepts a complete command argument and rejects tree nodes', () => {
    assert.deepEqual(parseGitFlowRequest(feature), feature);
    assert.deepEqual(parseGitFlowRequest({ action: 'init' }), {
      action: 'init',
      kind: undefined,
      name: undefined,
    });
    assert.equal(parseGitFlowRequest({ label: 'main' }), null);
    assert.equal(parseGitFlowRequest({ action: 'start', kind: 'bugfix' }), null);
    assert.equal(parseGitFlowRequest(null), null);
  });
});

describe('validateGitFlowRequest', () => {
  it('requires a safe name except for init', () => {
    assert.equal(validateGitFlowRequest({ action: 'init' }), null);
    assert.equal(validateGitFlowRequest({ action: 'start', kind: 'feature' }), 'A name is required.');
    assert.equal(validateGitFlowRequest({ action: 'finish', name: 'widget' }), 'Choose a feature, release, or hotfix flow.');
    assert.ok(validateGitFlowRequest({ action: 'publish', kind: 'release', name: '../x' }));
    assert.equal(validateGitFlowRequest(feature), null);
  });
});

describe('gitFlowArgs', () => {
  it('builds non-interactive git-flow argv', () => {
    assert.throws(() => gitFlowArgs({ action: 'init' }), /does not use the git-flow command/);
    assert.deepEqual(gitFlowArgs({ action: 'finish', kind: 'hotfix', name: '1.2.3' }), [
      'flow',
      'hotfix',
      'finish',
      '1.2.3',
    ]);
  });
});

describe('parseGitFlowVersion', () => {
  it('reads a version line and rejects a missing subcommand', () => {
    assert.equal(parseGitFlowVersion('1.12.3 (AVH Edition)\n'), '1.12.3 (AVH Edition)');
    assert.equal(parseGitFlowVersion('', "git: 'flow' is not a git command."), null);
    assert.equal(parseGitFlowVersion(''), null);
  });
});

describe('resolveGitFlowLayout', () => {
  it('prefers gitflow config, then main, then master', () => {
    assert.equal(resolveGitFlowLayout({}, ['master']).production, 'master');
    assert.equal(resolveGitFlowLayout({}, ['main', 'master']).production, 'main');
    assert.deepEqual(resolveGitFlowLayout({}, []).production, 'main');
    const parsed = parseGitFlowConfig(
      'gitflow.branch.master trunk\ngitflow.prefix.feature f/\ngitflow.prefix.support support/\n',
    );
    const layout = resolveGitFlowLayout(parsed, ['main']);
    assert.equal(layout.production, 'trunk');
    assert.equal(layout.featurePrefix, 'f/');
    assert.equal(layout.develop, DEFAULT_GIT_FLOW_LAYOUT.develop);
  });
});

describe('fallbackGitCommands', () => {
  it('documents feature, release, and hotfix flows without running git-flow', () => {
    const start = fallbackGitCommands(feature);
    assert.deepEqual(start, ['git checkout develop', 'git checkout -b feature/widget']);
    assert.ok(start.every((line) => !line.startsWith('git flow')));

    assert.deepEqual(fallbackGitCommands({ action: 'publish', kind: 'feature', name: 'widget' }), [
      'git checkout feature/widget',
      'git push -u origin feature/widget',
    ]);
    assert.deepEqual(fallbackGitCommands({ action: 'finish', kind: 'feature', name: 'widget' }), [
      'git checkout develop',
      'git merge --no-ff feature/widget',
      'git branch -d feature/widget',
    ]);
    assert.deepEqual(fallbackGitCommands({ action: 'start', kind: 'hotfix', name: '1.2.3' }), [
      'git checkout main',
      'git checkout -b hotfix/1.2.3',
    ]);
    const releaseFinish = fallbackGitCommands({ action: 'finish', kind: 'release', name: '1.2.3' });
    assert.ok(releaseFinish.includes('git tag -a 1.2.3 -m 1.2.3'));
    assert.ok(releaseFinish.includes('git merge --no-ff release/1.2.3'));

    const guide = formatGitFlowFallback(start);
    assert.match(guide, /not installed/);
    assert.match(guide, /were not run/);
    assert.match(guide, /tag\.gpgSign/);
  });

  it('uses a master production branch when that is the only head', () => {
    const layout = resolveGitFlowLayout({}, ['master']);
    assert.deepEqual(fallbackGitCommands({ action: 'start', kind: 'hotfix', name: '1' }, layout), [
      'git checkout master',
      'git checkout -b hotfix/1',
    ]);
    assert.throws(() => fallbackGitCommands({ action: 'init' }, layout));
  });
});

const INIT = {
  production: 'main',
  develop: 'develop',
  featurePrefix: 'feature/',
  releasePrefix: 'release/',
  hotfixPrefix: 'hotfix/',
  versionTagPrefix: '',
};

describe('git-flow init', () => {
  it('reads init overrides from a command argument and ignores other fields', () => {
    assert.deepEqual(
      parseGitFlowRequest({ action: 'init', init: { production: 'trunk', develop: 3, extra: 'x' } })?.init,
      { production: 'trunk' },
    );
    assert.equal(parseGitFlowRequest({ action: 'init', init: 'main' })?.init, undefined);
  });

  it('is initialized once both branches are configured', () => {
    assert.equal(isGitFlowInitialized({}), false);
    assert.equal(isGitFlowInitialized({ production: 'main' }), false);
    assert.equal(isGitFlowInitialized(parseGitFlowConfig('gitflow.branch.master main\ngitflow.branch.develop dev\n')), true);
  });

  it('starts from the configured layout, then the usual defaults', () => {
    assert.deepEqual(gitFlowInitDefaults({}, ['master']), { ...INIT, production: 'master' });
    assert.deepEqual(
      gitFlowInitDefaults(parseGitFlowConfig('gitflow.prefix.feature f/\ngitflow.prefix.versiontag v\n'), ['main']),
      { ...INIT, featurePrefix: 'f/', versionTagPrefix: 'v' },
    );
  });

  it('accepts the usual layout and an empty version tag prefix', () => {
    assert.deepEqual(validateGitFlowInit(INIT, ['main']), {});
    assert.deepEqual(validateGitFlowInit({ ...INIT, versionTagPrefix: 'v' }, ['main']), {});
  });

  const invalid: [string, Partial<typeof INIT>, string[], string][] = [
    ['a missing production branch', { production: 'trunk' }, ['main'], 'production'],
    ['an empty production branch', { production: ' ' }, ['main'], 'production'],
    ['an unsafe development branch', { develop: '--force' }, ['main'], 'develop'],
    ['the same branch for production and development', { develop: 'main' }, ['main'], 'develop'],
    ['an empty feature prefix', { featurePrefix: '' }, ['main'], 'featurePrefix'],
    ['a prefix with spaces', { releasePrefix: 'rel eases/' }, ['main'], 'releasePrefix'],
    ['a prefix with parent segments', { hotfixPrefix: '../' }, ['main'], 'hotfixPrefix'],
    ['an unsafe version tag prefix', { versionTagPrefix: '-v' }, ['main'], 'versionTagPrefix'],
    ['the same prefix for two kinds', { releasePrefix: 'feature/' }, ['main'], 'releasePrefix'],
  ];
  for (const [name, change, branches, field] of invalid) {
    it(`rejects ${name}`, () => {
      assert.ok(validateGitFlowInit({ ...INIT, ...change }, branches)[field]);
    });
  }

  it('creates develop from production when missing, then records the layout and switches to it', () => {
    assert.deepEqual(gitFlowInitSteps({ ...INIT, develop: ' dev ', versionTagPrefix: 'v' }, false), [
      ['branch', 'dev', 'main'],
      ['config', 'gitflow.branch.master', 'main'],
      ['config', 'gitflow.branch.develop', 'dev'],
      ['config', 'gitflow.prefix.feature', 'feature/'],
      ['config', 'gitflow.prefix.release', 'release/'],
      ['config', 'gitflow.prefix.hotfix', 'hotfix/'],
      ['config', 'gitflow.prefix.versiontag', 'v'],
      ['checkout', 'dev'],
    ]);
  });

  it('reuses an existing development branch', () => {
    const steps = gitFlowInitSteps(INIT, true);
    assert.equal(steps.some((args) => args[0] === 'branch'), false);
    assert.deepEqual(steps.at(-1), ['checkout', 'develop']);
  });
});
