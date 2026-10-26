import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

/**
 * Lists string literals that look like text for people (a capital letter, words, no code characters)
 * and are not passed to `t()` or `l10n.t()`. Logging, thrown programmer errors and tests are skipped.
 */
const ROOTS = ['src', 'webview'];
const SKIP_FILE = /\.(test|integration\.test|e2e\.test)\.ts$|(^|\/)(dev|scenarioFixtures|serviceTestUtils|gitRepoHarness)/;
const LOG_CALL = /^(log|console)\.|^(log\w*)\./;
const PROSE = /^[A-Z][a-z]+(?:[ '’][A-Za-z.,:;'’()"{}0-9…-]+)*[.:…?!]?$/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });
}

function isLocalizedCall(node: ts.Node): boolean {
  const call = node.parent;
  if (!ts.isCallExpression(call)) { return false; }
  const callee = call.expression.getText();
  return callee === 't' || callee === 'l10n.t' || callee === 'vscode.l10n.t' || LOG_CALL.test(callee);
}

export function findUnlocalized(): string[] {
  const found: string[] = [];
  for (const root of ROOTS) {
    for (const path of files(root)) {
      if (SKIP_FILE.test(path)) { continue; }
      const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.ES2022, true);
      const visit = (node: ts.Node): void => {
        if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && PROSE.test(node.text)
          && !isLocalizedCall(node) && !ts.isImportDeclaration(node.parent) && !ts.isLiteralTypeNode(node.parent)) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart());
          found.push(`${path}:${line + 1}: ${node.text}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  return found;
}

if (process.argv[1]?.endsWith('findUnlocalized.ts')) {
  console.log(findUnlocalized().join('\n'));
}
