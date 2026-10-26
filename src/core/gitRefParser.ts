import { createLogger } from '../log';
import type {
  RefBranchDto,
  RefRemoteBranchDto,
  RefRemoteDto,
  RefTagDto,
} from '../shared/branches/refsProtocol';

const BRANCH_FIELDS = 5;
const REMOTE_BRANCH_FIELDS = 2;
const TAG_FIELDS = 3;

function splitForEachRefRecords(output: string, fieldsPerRecord: number): string[][] {
  const trimmed = output.trimEnd();
  if (!trimmed) {
    return [];
  }

  if (trimmed.includes('\n')) {
    return trimmed
      .split(/\r?\n/)
      .filter((line) => line.length > 0)
      .map((line) => line.split('\0'))
      .filter((tokens) => tokens[0]?.trim())
      .map((tokens) => tokens.slice(0, fieldsPerRecord));
  }

  const tokens = trimmed.split('\0');
  const records: string[][] = [];
  for (let i = 0; i + fieldsPerRecord - 1 < tokens.length; i += fieldsPerRecord) {
    records.push(tokens.slice(i, i + fieldsPerRecord));
  }
  return records;
}

const log = createLogger('refs');

export function parseLocalBranches(output: string, headName: string | null): RefBranchDto[] {
  const branches: RefBranchDto[] = [];

  for (const tokens of splitForEachRefRecords(output, BRANCH_FIELDS)) {
    const name = tokens[0]?.trim();
    if (!name) {
      continue;
    }
    const shortSha = tokens[1]?.trim() ?? '';
    const upstreamRaw = tokens[2]?.trim() ?? '';
    const upstream = upstreamRaw || null;
    const trackRaw = tokens[3]?.trim() ?? '';
    const upstreamTrack = trackRaw || null;
    const headMarker = tokens[4]?.trim() ?? '';
    const isHead = headMarker === '*' || (headName !== null && name === headName);

    branches.push({
      name,
      shortSha,
      upstream,
      upstreamTrack,
      isHead,
    });
  }

  return branches;
}

export function parseRemoteBranches(output: string): RefRemoteBranchDto[] {
  const branches: RefRemoteBranchDto[] = [];

  for (const tokens of splitForEachRefRecords(output, REMOTE_BRANCH_FIELDS)) {
    const name = tokens[0]?.trim();
    if (!name) {
      continue;
    }
    const shortSha = tokens[1]?.trim() ?? '';
    const slash = name.indexOf('/');
    const remote = slash > 0 ? name.slice(0, slash) : name;

    branches.push({ name, shortSha, remote });
  }

  return branches;
}

export function parseTags(output: string): RefTagDto[] {
  const tags: RefTagDto[] = [];

  for (const tokens of splitForEachRefRecords(output, TAG_FIELDS)) {
    const name = tokens[0]?.trim();
    if (!name) {
      continue;
    }
    const shortSha = tokens[1]?.trim() ?? '';
    const objectType = tokens[2]?.trim() ?? 'commit';
    const kind = objectType === 'tag' ? 'annotated' : 'lightweight';

    tags.push({ name, shortSha, kind });
  }

  return tags;
}

export function parseRemoteNames(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function parseRevListLeftRightCount(output: string): { left: number; right: number } {
  const parts = output.trim().split(/\s+/);
  const left = Number.parseInt(parts[0] ?? '0', 10) || 0;
  const right = Number.parseInt(parts[1] ?? '0', 10) || 0;
  return { left, right };
}

export async function loadRemoteUrls(
  cli: { execRead: (args: string[]) => Promise<{ stdout: string }> },
  names: string[],
): Promise<RefRemoteDto[]> {
  // One lookup per remote, all at once; the answers keep the order of `names`.
  return Promise.all(
    names.map(async (name): Promise<RefRemoteDto> => {
      try {
        const result = await cli.execRead(['remote', 'get-url', '--all', name]);
        const urls = result.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        return { name, urls };
      } catch (error) {
        // A remote with no readable URL is listed without one.
        log.debug(`could not read the URL of remote ${name}`, error);
        return { name, urls: [] };
      }
    }),
  );
}
