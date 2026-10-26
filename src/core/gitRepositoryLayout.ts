import * as fs from 'fs';
import * as path from 'path';
import type { GitCli } from './gitCli';

export interface GitRepositoryLayout {
  repoRoot: string;
  gitDir: string;
  commonDir: string;
  headPath: string;
  indexPath: string;
  packedRefsPath: string;
  refsDir: string;
  reftableDir: string | null;
  worktreesDir: string;
  modulesDir: string;
  configPath: string;
}

export async function resolveRepositoryLayout(
  cli: GitCli,
  repoRoot: string,
): Promise<GitRepositoryLayout> {
  const dirs = await cli.resolveGitDirectories();
  const gitDir = dirs.gitDir;
  const commonDir = dirs.commonDir;

  const reftablePath = path.join(commonDir, 'reftable');

  return {
    repoRoot,
    gitDir,
    commonDir,
    headPath: path.join(gitDir, 'HEAD'),
    indexPath: path.join(gitDir, 'index'),
    packedRefsPath: path.join(commonDir, 'packed-refs'),
    refsDir: path.join(commonDir, 'refs'),
    reftableDir: fs.existsSync(reftablePath) ? reftablePath : null,
    worktreesDir: path.join(commonDir, 'worktrees'),
    modulesDir: path.join(commonDir, 'modules'),
    configPath: path.join(commonDir, 'config'),
  };
}
