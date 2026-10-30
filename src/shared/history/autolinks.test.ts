import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  autolinksBodyAttribute,
  isAutolinkUrl,
  parseAutolinkRules,
  parseAutolinksAttribute,
  segmentReferences,
  type AutolinkRule,
} from './autolinks';

const jira: AutolinkRule = { prefix: 'JIRA-', url: 'https://jira.example.com/browse/JIRA-<num>', ignoreCase: false, alphanumeric: false };
const repo = { host: 'github.com', owner: 'octo', repo: 'app' };
const links = (text: string, rules: AutolinkRule[], github = repo) =>
  segmentReferences(text, github, rules).flatMap((segment) => (segment.kind === 'link' ? [[segment.text, segment.url]] : []));

describe('parseAutolinkRules', () => {
  it('keeps the entries that can work and fills in the options', () => {
    assert.deepEqual(parseAutolinkRules([{ prefix: ' JIRA- ', url: 'https://j.example.com/<num>' }]), [
      { prefix: 'JIRA-', url: 'https://j.example.com/<num>', ignoreCase: false, alphanumeric: false },
    ]);
    assert.equal(parseAutolinkRules([{ prefix: 'A-', url: 'http://t.test/<num>', ignoreCase: true, alphanumeric: true }])[0].ignoreCase, true);
  });

  it('drops what is not a rule, a prefix, a <num> URL, or an http(s) address without a login', () => {
    const bad = [
      null, 'JIRA-', {}, { prefix: '', url: 'https://x.test/<num>' }, { prefix: 'A-', url: 'https://x.test/no-number' },
      { prefix: 'A-', url: 'javascript:alert(<num>)' }, { prefix: 'A-', url: 'ftp://x.test/<num>' }, { prefix: 'A-', url: 'https://u:p@x.test/<num>' },
      { prefix: 'A'.repeat(41), url: 'https://x.test/<num>' }, { prefix: 3, url: 'https://x.test/<num>' }, { prefix: 'A-', url: 'not a url <num>' },
    ];
    assert.deepEqual(parseAutolinkRules(bad), []);
    assert.deepEqual(parseAutolinkRules('nope'), []);
    assert.deepEqual(parseAutolinkRules(undefined), []);
  });

  it('keeps at most 50 rules', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ prefix: `P${i}-`, url: 'https://x.test/<num>' }));
    assert.equal(parseAutolinkRules(many).length, 50);
  });
});

describe('segmentReferences', () => {
  it('links a tracker reference, and still links GitHub ones', () => {
    assert.deepEqual(links('JIRA-123 fix, closes #7', [jira]), [
      ['JIRA-123', 'https://jira.example.com/browse/JIRA-123'],
      ['#7', 'https://github.com/octo/app/issues/7'],
    ]);
  });

  it('does not match inside a longer word or number, or without a number', () => {
    assert.deepEqual(links('XJIRA-1 JIRA-1a JIRA- JIRA-', [jira]), []);
    assert.deepEqual(links('see (JIRA-9), JIRA-10.', [jira]).map(([text]) => text), ['JIRA-9', 'JIRA-10']);
  });

  it('follows ignoreCase and alphanumeric', () => {
    assert.deepEqual(links('jira-5', [jira]), []);
    assert.deepEqual(links('jira-5', [{ ...jira, ignoreCase: true }]).map(([text]) => text), ['jira-5']);
    const clickUp: AutolinkRule = { prefix: 'CU-', url: 'https://app.clickup.com/t/<num>', ignoreCase: false, alphanumeric: true };
    assert.deepEqual(links('CU-86abc12', [clickUp]), [['CU-86abc12', 'https://app.clickup.com/t/86abc12']]);
    assert.deepEqual(links('CU-86abc12', [jira]), []);
  });

  it('escapes what goes into the address, and takes a prefix with regular expression characters literally', () => {
    const odd: AutolinkRule = { prefix: 'A.B+', url: 'https://x.test/q?id=<num>&again=<num>', ignoreCase: false, alphanumeric: true };
    assert.deepEqual(links('A.B+x%20y A1B+z', [odd]), [['A.B+x', 'https://x.test/q?id=x&again=x']]);
  });

  it('applies every rule and never links the same text twice', () => {
    const other: AutolinkRule = { prefix: 'JIRA-', url: 'https://other.test/<num>', ignoreCase: false, alphanumeric: false };
    assert.deepEqual(links('JIRA-1 and ABC-2', [jira, other, { ...jira, prefix: 'ABC-', url: 'https://abc.test/<num>' }]), [
      ['JIRA-1', 'https://jira.example.com/browse/JIRA-1'], ['ABC-2', 'https://abc.test/2'],
    ]);
  });

  it('gives the same segments as GitHub alone when there are no rules', () => {
    assert.deepEqual(segmentReferences('fix #3', repo, []), [{ kind: 'text', text: 'fix ' }, { kind: 'link', text: '#3', url: 'https://github.com/octo/app/issues/3' }]);
  });

  it('keeps all the text, in order', () => {
    const text = 'a JIRA-1 b JIRA-22 c #3 d';
    assert.equal(segmentReferences(text, repo, [jira]).map((segment) => segment.text).join(''), text);
  });
});

describe('isAutolinkUrl', () => {
  it('accepts an address on a site a rule sends to, and nothing else', () => {
    assert.equal(isAutolinkUrl('https://jira.example.com/browse/JIRA-1', [jira]), true);
    assert.equal(isAutolinkUrl('https://jira.example.com:8443/x', [jira]), false, 'another port is another site');
    assert.equal(isAutolinkUrl('http://jira.example.com/x', [jira]), false, 'another scheme is another origin');
    assert.equal(isAutolinkUrl('https://evil.test/x', [jira]), false);
    assert.equal(isAutolinkUrl('https://u:p@jira.example.com/x', [jira]), false);
    assert.equal(isAutolinkUrl('javascript:alert(1)', [jira]), false);
    assert.equal(isAutolinkUrl('https://jira.example.com/x', []), false);
    assert.equal(isAutolinkUrl('not a url', [jira]), false);
  });
});

describe('the body attribute', () => {
  it('round-trips the rules through an HTML attribute', () => {
    const attribute = autolinksBodyAttribute([{ ...jira, url: 'https://x.test/?a=<num>&b="q"' }]);
    assert.match(attribute, /^ data-autolinks="[^"<>]*"$/);
    const value = attribute.slice(' data-autolinks="'.length, -1).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    assert.equal(parseAutolinksAttribute(value)[0].url, 'https://x.test/?a=<num>&b="q"');
  });

  it('is empty without rules, and reads nothing from what is not rules', () => {
    assert.equal(autolinksBodyAttribute([]), '');
    assert.deepEqual(parseAutolinksAttribute(undefined), []);
    assert.deepEqual(parseAutolinksAttribute('{broken'), []);
    assert.deepEqual(parseAutolinksAttribute('[{"prefix":"A-","url":"javascript:<num>"}]'), []);
  });
});
