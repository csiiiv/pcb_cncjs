// Probe repeatability statistics (GR&R-lite) for the autolevel test mode.
// Groups a raw attempt log (ordered positions, repeats of the same spot
// consecutive) into per-spot samples and computes dispersion stats.
//
// Interpretation guide (spindle-less touch probes on PCBs):
//   σ ≤ 0.005 mm  excellent — well within etch depth tolerances
//   σ ≤ 0.010 mm  good      — typical for a decent touch probe
//   σ ≤ 0.020 mm  fair      — check probe mounting / feed rate
//   σ >  0.020 mm poor      — investigate before trusting autolevel Z

const stats = (values) => {
  const n = values.length;
  if (!n) return { n: 0, mean: 0, std: 0, min: 0, max: 0, range: 0 };
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = n > 1 ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n,
    mean,
    std: Math.sqrt(variance), // sample std (n-1): a single attempt → 0
    min: sorted[0],
    max: sorted[n - 1],
    range: sorted[n - 1] - sorted[0],
  };
};

/**
 * Group an attempt log into per-spot samples. Spots are clustered by XY
 * proximity REGARDLESS of visit order — supporting both test designs:
 *   burst  — same spot probed N times consecutively
 *   cycled — all spots probed once per pass, whole cycle repeated N times
 * (backend snaps map probes to planned nodes, so repeated attempts at one
 * spot report identical XY; tolerance covers touch-mode quantisation).
 * @param {{x:number,y:number,z:number}[]} attempts ordered log
 * @param {number} [xyTol] mm — attempts within this XY distance join a spot
 */
export function groupAttempts(attempts, xyTol = 0.05) {
  const spots = [];
  for (const p of attempts) {
    const spot = spots.find((s) => Math.hypot(s.x - p.x, s.y - p.y) <= xyTol);
    if (spot) {
      spot.zs.push(Number(p.z));
    } else {
      spots.push({ x: Number(p.x), y: Number(p.y), zs: [Number(p.z)] });
    }
  }
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  return spots.map((s) => {
    const st = stats(s.zs);
    // drift = mean(second half) − mean(first half) of the chronological
    // attempts. In cycled mode this exposes time-dependent shift (thermal,
    // settling); in burst mode it shows settling within the burst.
    const half = Math.floor(s.zs.length / 2);
    const drift = s.zs.length >= 4 ? mean(s.zs.slice(half)) - mean(s.zs.slice(0, half)) : null;
    return { x: s.x, y: s.y, ...st, values: s.zs, drift };
  });
}

/**
 * Combined repeatability across all spots: pooled within-spot σ and the
 * worst spot's range. Works for both burst and cycled test designs (spots
 * are clustered by XY, not visit order). This is the number to compare
 * against your depth of cut per pass when deciding if autolevel
 * compensation is trustworthy.
 */
export function repeatability(attempts, xyTol = 0.05) {
  const spots = groupAttempts(attempts, xyTol);
  const multi = spots.filter((s) => s.n >= 2);
  const ss = multi.reduce((acc, s) => acc + (s.n - 1) * s.std ** 2, 0);
  const dof = multi.reduce((acc, s) => acc + (s.n - 1), 0);
  const pooled = dof > 0 ? Math.sqrt(ss / dof) : 0;
  const worst = multi.reduce((w, s) => (s.range > (w?.range ?? -Infinity) ? s : w), null);
  return {
    spots,
    spotCount: spots.length,
    attemptCount: attempts.length,
    pooledStd: pooled,
    worstSpot: worst,
    grade: pooled <= 0.005 ? 'excellent' : pooled <= 0.010 ? 'good' : pooled <= 0.020 ? 'fair' : 'poor',
  };
}
