/** One commit of a branch, with the local branches that already end at it. */
export interface StackCommit {
  sha: string;
  subject: string;
  body: string;
  branches: string[];
}

/** The commits of one pull request in a stack: those after the layer below, up to and including `head`. */
export interface StackLayer {
  head: StackCommit;
  commits: StackCommit[];
}

/**
 * Cuts a branch's commits (oldest first) into the layers of a stack. A commit in `ends` finishes a layer; the commits
 * between two ends belong to the upper one. The newest commit always finishes a layer, because the branch itself is the
 * top of the stack.
 */
export function layersOf(commits: readonly StackCommit[], ends: ReadonlySet<string>): StackLayer[] {
  const layers: StackLayer[] = [];
  let pending: StackCommit[] = [];
  commits.forEach((commit, index) => {
    pending.push(commit);
    if (index === commits.length - 1 || ends.has(commit.sha)) {
      layers.push({ head: commit, commits: pending });
      pending = [];
    }
  });
  return layers;
}

/** The commits that finish a layer before anyone chooses: the newest, and each one a branch already ends at. */
export function defaultEnds(commits: readonly StackCommit[]): Set<string> {
  const ends = new Set(commits.filter((commit) => commit.branches.length > 0).map((commit) => commit.sha));
  const newest = commits.at(-1);
  if (newest) {
    ends.add(newest.sha);
  }
  return ends;
}

/** What a pull request says to begin with: the body of its only commit, or else a list of its commits' subjects. */
export function layerBody(layer: StackLayer): string {
  return layer.commits.length === 1 ? layer.head.body : layer.commits.map((commit) => `- ${commit.subject}`).join('\n');
}

const SLUG_WORDS = 5;
const SLUG_LENGTH = 40;

/** A branch name for a layer: the stack's top branch, then the words of the layer's subject, unlike every name in `taken`. */
export function layerBranchName(top: string, subject: string, taken: ReadonlySet<string>): string {
  const words = subject
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, SLUG_WORDS)
    .join('-')
    .slice(0, SLUG_LENGTH)
    .replace(/-+$/, '');
  const base = words ? `${top}-${words}` : `${top}-layer`;
  let name = base;
  for (let n = 2; taken.has(name); n++) {
    name = `${base}-${n}`;
  }
  return name;
}
