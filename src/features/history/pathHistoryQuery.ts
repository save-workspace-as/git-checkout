import {
  PATH_HISTORY_PAGE_SIZE,
  type PathHistoryRequest,
} from '../../shared/history/pathHistoryProtocol';
import { GRAPH_LOG_FORMAT } from '../graph/commitGraphService';

export function buildPathHistoryLogArgs(request: PathHistoryRequest): string[] {
  const limit = request.limit ?? PATH_HISTORY_PAGE_SIZE;
  const skip = request.skip > 0 ? Math.floor(request.skip) : 0;
  const path = request.path.replace(/\\/g, '/');
  const args = [
    'log',
    '-n',
    String(limit),
    '--date-order',
    '--decorate=full',
    '--date=unix',
    '--no-patch',
    `--pretty=format:${GRAPH_LOG_FORMAT}`,
  ];
  if (skip > 0) {
    args.push(`--skip=${skip}`);
  }
  if (!request.includeMerges) {
    args.push('--no-merges');
  }
  if (request.scope === 'hunk') {
    const start = Math.max(1, Math.floor(request.startLine ?? 1));
    const end = Math.max(start, Math.floor(request.endLine ?? start));
    args.push('-L', `${start},${end}:${path}`);
    return args;
  }
  if (request.scope === 'file' && request.follow) {
    args.push('--follow');
    if (request.includeMerges) {
      args.push('-m');
    }
  }
  args.push('--', path);
  return args;
}

export function buildResetFileArgs(revision: string, path: string): string[] {
  return ['checkout', revision, '--', path.replace(/\\/g, '/')];
}

export function buildResetPreviewArgs(revision: string, path: string): string[] {
  return ['diff', '--no-color', '--stat', revision, '--', path.replace(/\\/g, '/')];
}
