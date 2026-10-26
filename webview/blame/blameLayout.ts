/** Which lines start a run of the same commit, so the blame details show once per run. */
export function runStarts(shas: readonly string[]): boolean[] {
  return shas.map((sha, index) => sha !== '' && sha !== shas[index - 1]);
}
