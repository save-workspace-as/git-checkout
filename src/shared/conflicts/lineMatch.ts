/**
 * For each line of `a`, the index of the line of `b` it is paired with in a shortest edit script (Myers'
 * algorithm), or nothing when the line is not in `b`. Nothing is returned for the whole comparison when the
 * two differ in more than `maxEdits` lines, which keeps a comparison of unrelated files cheap.
 */
export function matchLines(a: readonly string[], b: readonly string[], maxEdits = 1500): (number | undefined)[] | undefined {
  const matched = new Array<number | undefined>(a.length).fill(undefined);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    matched[start] = start;
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
    matched[endA] = endB;
  }
  const left = a.slice(start, endA);
  const right = b.slice(start, endB);
  const n = left.length;
  const m = right.length;
  if (n === 0 || m === 0) {
    return matched;
  }

  const max = Math.min(n + m, maxEdits);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  // `trace[d]` is the furthest point of each diagonal before the edits of step `d`.
  const trace: Int32Array[] = [];
  let edits = -1;
  search: for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && left[x] === right[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        edits = d;
        break search;
      }
    }
  }
  if (edits < 0) {
    return undefined;
  }

  let x = n;
  let y = m;
  for (let d = edits; d > 0; d--) {
    const before = trace[d];
    const k = x - y;
    const previousK = k === -d || (k !== d && before[offset + k - 1] < before[offset + k + 1]) ? k + 1 : k - 1;
    const previousX = before[offset + previousK];
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      x--;
      y--;
      matched[start + x] = start + y;
    }
    x = previousX;
    y = previousY;
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    matched[start + x] = start + y;
  }
  return matched;
}
