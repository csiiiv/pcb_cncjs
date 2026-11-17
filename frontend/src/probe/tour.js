// Probe tour optimization (auto_level.md §10: safe probing order).
// The physical cost of a probe cycle is dominated by XY rapid travel (each
// point pays the same plunge/retract regardless of order), so we minimize
// total XY path length. Three strategies run; the shortest tour wins:
//
//   1. held-karp DP      — exact optimum, only viable for n ≤ 12
//   2. serpentine        — boustrophedon rows; near-optimal for lattice rows
//                          and what a human would do by hand
//   3. nearest-neighbor  — O(n²) construction seeded from the machine
//        + 2-opt         — reverse-segment passes until no improvement
//
// Order only affects travel, never which points are probed: measurements are
// matched back to vertices by coordinates.

const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

const tourLength = (pts, start) => {
  let d = 0;
  let prev = start;
  for (const p of pts) {
    if (prev) d += Math.sqrt(dist2(prev, p));
    prev = p;
  }
  return d;
};

/** Exact TSP path (open, no return) via Held-Karp. n ≤ 12 only. */
function heldKarp(pts, start) {
  const n = pts.length;
  const startIdx = start ? n : -1; // virtual start = index n
  const full = 1 << n;
  // dp[mask][j] = min cost visiting set `mask`, ending at j
  const dp = Array.from({ length: full }, () => new Float64Array(n).fill(Infinity));
  const from = Array.from({ length: full }, () => new Int16Array(n).fill(-1));
  const d = (i, j) => Math.sqrt(dist2(pts[i], pts[j]));
  for (let j = 0; j < n; j++) {
    dp[1 << j][j] = start ? Math.sqrt(dist2(start, pts[j])) : 0;
  }
  for (let mask = 1; mask < full; mask++) {
    for (let j = 0; j < n; j++) {
      if (!(mask & (1 << j))) continue;
      const base = dp[mask][j];
      if (!Number.isFinite(base)) continue;
      for (let k = 0; k < n; k++) {
        if (mask & (1 << k)) continue;
        const nm = mask | (1 << k);
        const nd = base + d(j, k);
        if (nd < dp[nm][k]) {
          dp[nm][k] = nd;
          from[nm][k] = j;
        }
      }
    }
  }
  const all = full - 1;
  let bestEnd = 0;
  for (let j = 1; j < n; j++) {
    if (dp[all][j] < dp[all][bestEnd]) bestEnd = j;
  }
  // walk back
  const order = new Array(n);
  let mask = all;
  let j = bestEnd;
  for (let i = n - 1; i >= 0; i--) {
    order[i] = pts[j];
    const pj = from[mask][j];
    mask ^= 1 << j;
    j = pj;
    if (j < 0 && i > 0) return null; // broken chain (shouldn't happen)
  }
  return order;
}

/** Boustrophedon rows: sweep Y ascending, alternate X direction per row. */
function serpentine(pts) {
  const sorted = [...pts].sort((a, b) => a.y - b.y || a.x - b.x);
  // cluster into rows: y gap larger than 1/3 of the y span's median gap
  const ys = sorted.map((p) => p.y);
  const gaps = [];
  for (let i = 1; i < ys.length; i++) gaps.push(ys[i] - ys[i - 1]);
  gaps.sort((a, b) => a - b);
  const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 1;
  const rowTol = Math.max(0.05, medianGap * 0.4);

  const rows = [];
  for (const p of sorted) {
    const last = rows[rows.length - 1];
    if (!last || Math.abs(last.y - p.y) > rowTol) rows.push({ y: p.y, pts: [p] });
    else last.pts.push(p);
  }
  const out = [];
  rows.forEach((row, i) => {
    const xs = row.pts.sort((a, b) => a.x - b.x);
    out.push(...(i % 2 ? [...xs].reverse() : xs));
  });
  return out;
}

/** Nearest-neighbor construction from `start` (or first point). */
function nearestNeighbor(pts, start) {
  const remaining = [...pts];
  const out = [];
  let cur = start || null;
  while (remaining.length) {
    let bi = 0;
    if (cur) {
      let bd = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const d = dist2(cur, remaining[i]);
        if (d < bd) { bd = d; bi = i; }
      }
    }
    cur = remaining.splice(bi, 1)[0];
    out.push(cur);
  }
  return out;
}

/** 2-opt: reverse segments while it shortens the tour. Bounded passes. */
function twoOpt(order, start, maxPasses = 40) {
  const pts = [...order];
  const n = pts.length;
  const gain = (i, j) => {
    // delta of reversing pts[i..j] — edges (i-1,i) and (j,j+1) change
    const a = i > 0 ? pts[i - 1] : start;
    const b = pts[j + 1] || null;
    const before = (a ? Math.sqrt(dist2(a, pts[i])) : 0) + (b ? Math.sqrt(dist2(pts[j], b)) : 0);
    const after = (a ? Math.sqrt(dist2(a, pts[j])) : 0) + (b ? Math.sqrt(dist2(pts[i], b)) : 0);
    return before - after;
  };
  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false;
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        if (gain(i, j) > 1e-9) {
          // reverse segment i..j in place
          for (let lo = i, hi = j; lo < hi; lo++, hi--) {
            [pts[lo], pts[hi]] = [pts[hi], pts[lo]];
          }
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return pts;
}

/**
 * Order probe points for minimal XY travel.
 * @param {{x:number,y:number}[]} points to visit (not mutated)
 * @param {{x:number,y:number}|null} [start] current machine XY, if known
 * @returns {{x:number,y:number}[]} new array in visiting order
 */
export function planProbeOrder(points, start = null) {
  const pts = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length <= 2) return pts;

  const candidates = [];
  if (pts.length <= 12) {
    const exact = heldKarp(pts, start);
    if (exact) candidates.push(exact);
  }
  const serp = serpentine(pts);
  candidates.push(serp);
  const nn = twoOpt(nearestNeighbor(pts, start), start);
  candidates.push(nn);

  let best = null;
  let bestLen = Infinity;
  for (const c of candidates) {
    const len = tourLength(c, start);
    if (len < bestLen) { bestLen = len; best = c; }
  }
  return best;
}

/** Total travel length of a visiting order (for UI feedback). */
export function tourLengthOf(points, start = null) {
  return tourLength(points, start);
}
