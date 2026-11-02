// Brings the docs, the changelog and the screenshots from the extension repository, so each lives in one place.
// The extension is the folder above this one, or the one `EXTENSION_PATH` names.
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extension = resolve(site, process.env.EXTENSION_PATH ?? '..');
const docs = join(site, 'src/content/docs');

const readme = readFileSync(join(extension, 'README.md'), 'utf8');
const sections = Object.fromEntries(
  readme
    .split(/\n(?=## )/)
    .slice(1)
    .map((part) => [part.split('\n', 1)[0].slice(3).trim(), part.slice(part.indexOf('\n') + 1).trim()]),
);

const page = (slug, title, description, order, body) => {
  mkdirSync(join(docs, 'docs'), { recursive: true });
  // The README points at docs/screenshots; a page of the site reaches the same pictures through the assets folder.
  const fixed = body.replaceAll('](docs/screenshots/', '](../../../assets/screenshots/');
  writeFileSync(join(docs, 'docs', `${slug}.md`), `---\ntitle: ${title}\ndescription: ${description}\nsidebar:\n  order: ${order}\n---\n\n${fixed.trim()}\n`);
};

/** The README's sections that tell what the extension does, one after the other, under the headings they have there. */
const FEATURE_SECTIONS = [
  'See your whole history',
  'Stage exactly what you mean',
  'Know who changed every line',
  'Pull requests, without leaving the editor',
  'Branches, tags, stashes, worktrees and submodules',
  'Rebase and resolve with confidence',
  'Look at any commit, any file',
  'And the rest',
];
for (const name of ['Get started in a minute', 'A sidebar for the whole repository', 'Requirements', ...FEATURE_SECTIONS]) {
  if (!sections[name]) { throw new Error(`The README has no "${name}" section; update scripts/sync-from-extension.mjs.`); }
}

page('getting-started', 'Getting started', 'Install Git Checkout and open your first repository.', 1, [
  'Git Checkout runs on the **workspace** side, so Git always runs on the same machine as your folder: local, WSL, SSH, Dev Containers or Codespaces.',
  `## Requirements\n\n${sections.Requirements}`,
  '## Install\n\nInstall **Git Checkout** (`rkonit.gitcheckout`) from the VS Code Marketplace, or run `ext install rkonit.gitcheckout` in the Quick Open box.',
  `## First steps\n\n${sections['Get started in a minute']}`,
].join('\n\n'));
page('sidebar', 'The sidebar', 'Where everything is, from repositories and changes to commits, files and branches.', 2, sections['A sidebar for the whole repository']);
page('features', 'Features', 'What Git Checkout does, from the commit graph to merge conflicts.', 3, FEATURE_SECTIONS.map((name) => `## ${name}\n\n${sections[name]}`).join('\n\n'));
page('settings', 'Settings', 'Every Git Checkout setting and what it does.', 4, sections.Settings);
page('shortcuts', 'Keyboard shortcuts', 'The shortcuts that work in Git Checkout views, and how to change them.', 5, sections['Keyboard shortcuts']);
page('extending', 'Extending', 'Custom commands, external diff and merge tools, and .gitignore helpers.', 6, sections.Extending);
page('remote', 'Remote workspaces', 'Using Git Checkout over WSL, SSH, Dev Containers and Codespaces.', 7, sections['Remote workspaces'].replace('### Git path', '## Git path'));
page('privacy', 'Privacy', 'What Git Checkout sends over the network, which is almost nothing.', 8, sections.Privacy);

const changelog = readFileSync(join(extension, 'CHANGELOG.md'), 'utf8').replace(/^# Changelog\s*/, '');
writeFileSync(
  join(docs, 'changelog.md'),
  `---\ntitle: Changelog\ndescription: What changed in each release of Git Checkout.\nsidebar:\n  order: 99\n---\n\n${changelog.trim()}\n`,
);

const shots = join(site, 'src/assets/screenshots');
rmSync(shots, { recursive: true, force: true });
cpSync(join(extension, 'docs/screenshots'), shots, { recursive: true });
// The picture a link to the site shows on social networks and in chats.
mkdirSync(join(site, 'public'), { recursive: true });
cpSync(join(shots, '01-commit-graph.png'), join(site, 'public/og.png'));
cpSync(join(extension, 'resources/git-checkout.svg'), join(site, 'public/favicon.svg'));

console.log(`Synced from ${extension}: ${readdirSync(join(docs, 'docs')).length} docs, the changelog and ${readdirSync(shots).length} screenshots.`);
