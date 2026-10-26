import { GitCliError } from './gitCliError';
import { getGitCliRegistry } from './gitCliRegistry';
import type { GitExtensionService } from './gitExtensionService';
import { createLogger } from '../log';

const log = createLogger('smoke');

function formatSmokeError(error: unknown): string {
  if (error instanceof GitCliError) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export async function runGitCliSmoke(
  gitService: GitExtensionService,
  showErrorToast: boolean,
): Promise<void> {
  const diagnostics = gitService.getDiagnostics();
  if (diagnostics.bindingState !== 'ready') {
    log.info(`skipped: binding is ${diagnostics.bindingState}.`);
    return;
  }

  const registry = getGitCliRegistry();
  const repos = gitService.getRepositories();
  registry.syncOpenRepositories(repos.map((r) => r.rootUri.fsPath));

  if (repos.length === 0) {
    log.info('skipped: no open git repositories.');
    return;
  }

  const gitPath = gitService.getGitPath() ?? 'unknown';

  for (const repo of repos) {
    const root = repo.rootUri.fsPath;
    try {
      const cli = registry.forRepository(repo);
      const inside = await cli.isInsideWorkTree({ showErrorToast });
      if (inside) {
        log.info(`OK: inside work tree at ${root} (git=${gitPath})`);
      } else {
        log.warn(`not inside work tree at ${root} (git=${gitPath})`);
      }
    } catch (error) {
      log.warn(`failed for ${root}: ${formatSmokeError(error)}`);
    }
  }
}
