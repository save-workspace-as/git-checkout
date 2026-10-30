import { strict as assert } from 'node:assert';
import { afterEach, before, describe, it } from 'node:test';

import { installDom, resetDom } from './testing/dom';

installDom();

describe('githubLinkedText', () => {
  let render: typeof import('lit').render;
  let githubLinkedText: typeof import('./githubLinkText').githubLinkedText;
  const repo = { host: 'github.com', owner: 'octo', repo: 'app' };

  before(async () => {
    ({ render } = await import('lit'));
    ({ githubLinkedText } = await import('./githubLinkText'));
  });

  afterEach(resetDom);

  const show = (text: string): { links: { text: string; title: string }[]; opened: string[] } => {
    const opened: string[] = [];
    const container = document.createElement('div');
    document.body.append(container);
    render(githubLinkedText(text, repo, (url) => opened.push(url)), container);
    const links = [...container.querySelectorAll('button.github-ref')].map((button) => ({ text: button.textContent ?? '', title: button.getAttribute('title') ?? '' }));
    for (const button of container.querySelectorAll('button.github-ref')) {
      (button as HTMLElement).click();
    }
    return { links, opened };
  };

  it('links GitHub references, and the page\'s autolinks once it has some', () => {
    assert.deepEqual(show('JIRA-4 and #5').links.map((link) => link.text), ['#5']);

    document.body.dataset.autolinks = JSON.stringify([{ prefix: 'JIRA-', url: 'https://jira.example.com/browse/JIRA-<num>' }]);
    const shown = show('JIRA-4 and #5');
    assert.deepEqual(shown.links, [
      { text: 'JIRA-4', title: 'https://jira.example.com/browse/JIRA-4' },
      { text: '#5', title: 'https://github.com/octo/app/issues/5' },
    ]);
    assert.deepEqual(shown.opened, ['https://jira.example.com/browse/JIRA-4', 'https://github.com/octo/app/issues/5']);
  });

  it('follows a change of the rules, and ignores rules that cannot work', () => {
    document.body.dataset.autolinks = JSON.stringify([{ prefix: 'OLD-', url: 'https://old.test/<num>' }]);
    assert.deepEqual(show('OLD-1 NEW-2').links.map((link) => link.text), ['OLD-1']);
    document.body.dataset.autolinks = JSON.stringify([{ prefix: 'NEW-', url: 'https://new.test/<num>' }]);
    assert.deepEqual(show('OLD-1 NEW-2').links.map((link) => link.text), ['NEW-2']);
    document.body.dataset.autolinks = JSON.stringify([{ prefix: 'BAD-', url: 'javascript:alert(<num>)' }]);
    assert.deepEqual(show('BAD-1').links, []);
  });
});
