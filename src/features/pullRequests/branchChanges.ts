import type { GitCli } from '../../core/gitCli';
import { revisionArg } from '../../core/gitRevision';
import { createLogger } from '../../log';
import type { PullRequestPromptInput } from '../../shared/pullRequests/pullRequestPrompt';

const log = createLogger('pull-request-draft');

/** Most commits sent to the model; a branch with more is described by its newest ones. */
const MAX_COMMITS = 30;

/** The branch a pull request would merge into: the remote's default branch, or the first usual name the repository has. */
export async function findBaseBranch(cli: GitCli, branch: string): Promise<string | undefined> {
  const probe = async (args: string[]): Promise<string | undefined> => {
    try {
      return (await cli.execRead(args)).stdout.trim() || undefined;
    } catch (error) {
      // The remote has no default branch recorded, or the name is not a branch here: try the next one.
      log.debug(`${args[0]} had nothing to say`, error);
      return undefined;
    }
  };
  const remoteDefault = await probe(['symbolic-ref', '--short', '-q', 'refs/remotes/origin/HEAD']);
  for (const candidate of [remoteDefault, 'origin/main', 'origin/master', 'main', 'master']) {
    if (candidate && candidate !== branch && (await probe(['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`]))) {
      return candidate;
    }
  }
  return undefined;
}

/** What a branch adds to its base: its commits and their combined diff against the point where it left the base. */
export async function loadBranchChanges(cli: GitCli, branch: string): Promise<Omit<PullRequestPromptInput, 'branch'> | undefined> {
  const name = revisionArg(branch);
  const base = await findBaseBranch(cli, name);
  if (!base) {
    return undefined;
  }
  const listing = await cli.execRead(['log', `-n${MAX_COMMITS}`, '--format=%s%x00%b%x01', `${base}..${name}`]);
  const commits = listing.stdout
    .split('\x01')
    .map((record) => record.replace(/^\n/, ''))
    .filter((record) => record.trim() !== '')
    .map((record) => {
      const [subject = '', body = ''] = record.split('\0');
      return { subject: subject.trim(), body: body.trim() };
    });
  if (commits.length === 0) {
    return { base, commits, diff: '' };
  }
  const diff = (await cli.execRead(['diff', '--no-color', '-U2', '--patch-with-stat', `${base}...${name}`])).stdout;
  return { base, commits, diff };
}
