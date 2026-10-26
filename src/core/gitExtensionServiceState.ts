import type { GitExtensionService } from './gitExtensionService';

let service: GitExtensionService | undefined;

export function getGitExtensionService(): GitExtensionService | undefined {
  return service;
}

export function setGitExtensionService(instance: GitExtensionService | undefined): void {
  service = instance;
}
