/**
 * Times the git work behind the main views against a real repository, for finding what is slow on a large one.
 *
 *   npm run perf -- /path/to/repo [--runs 3] [--file path/inside/repo] [--trace]
 *
 * It only reads, except that `git status` may refresh the index, so point it at a copy of a repository you care about.
 * `--trace` prints every git command an operation runs, with its own time.
 */
import { createPerfContext, median, PERF_OPERATIONS, timeOperation } from './perfOps';

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const repoRoot = args.find((arg, index) => !arg.startsWith('--') && !(index > 0 && ['--runs', '--file'].includes(args[index - 1])));
if (!repoRoot) {
  console.error('usage: npm run perf -- <repository> [--runs 3] [--file path] [--trace]');
  process.exit(2);
}
const trace = args.includes('--trace');
const runs = Number(flag('--runs', trace ? '1' : '3'));

async function main(root: string): Promise<void> {
  const context = await createPerfContext(root, args.includes('--file') ? flag('--file', '') : undefined);
  if (trace) {
    const read = context.cli.execRead.bind(context.cli);
    context.cli.execRead = (async (gitArgs: string[], options?: never) => {
      const start = performance.now();
      try { return await read(gitArgs, options); } finally { console.log(`   ${(performance.now() - start).toFixed(0).padStart(6)} ms  git ${gitArgs.join(' ').slice(0, 150)}`); }
    }) as typeof context.cli.execRead;
  }
  const timings = [];
  for (const operation of PERF_OPERATIONS) {
    if (trace) { console.log(`\n${operation.name}`); }
    timings.push(await timeOperation(context, operation, runs));
  }
  console.log(`\n${root}  (${runs} runs, file ${context.file})\n`);
  for (const timing of timings) {
    console.log(`${median(timing.ms).toFixed(0).padStart(7)} ms  (min ${Math.min(...timing.ms).toFixed(0)})  ${timing.name}  ${timing.note}`);
  }
}

void main(repoRoot).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
