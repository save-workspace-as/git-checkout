import { readFileSync, writeFileSync } from 'node:fs';

import { applyRepositoryMenu } from '../ui/repositoryMenuModel';

const file = 'package.json';
const manifest = applyRepositoryMenu(JSON.parse(readFileSync(file, 'utf8')));
writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
console.log('Updated the repository menu entries in package.json');
