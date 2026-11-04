import type { GitCli } from '../../core/gitCli';
import { revisionArg } from '../../core/gitRevision';
import type { CommitExplainInput } from '../../shared/history/commitExplainPrompt';

/** What the model is shown of a commit: its full hash, message, and diff against its first parent (a merge shows what it brought in). */
export async function loadCommitForExplain(cli: GitCli, revision: string): Promise<CommitExplainInput & { sha: string }> {
  const name = revisionArg(revision);
  const sha = (await cli.execRead(['rev-parse', '--verify', `${name}^{commit}`])).stdout.trim();
  const [message, diff] = await Promise.all([
    cli.execRead(['log', '-1', '--format=%B', sha]),
    cli.execRead(['show', '--format=', '--no-color', '-U2', '--patch-with-stat', '--first-parent', '-m', sha]),
  ]);
  return { sha, message: message.stdout.trim(), diff: diff.stdout };
}
