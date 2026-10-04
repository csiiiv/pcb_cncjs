// Initial staggered triangular lattice over the machining bounds (auto_level.md §3).
// Row spacing s·√3/2 with alternating rows offset s/2 gives approximately
// uniform, isotropic spacing; corners and edges stay covered.

const round = (v) => Math.round(v * 1000) / 1000;

/**
 * @param {{minX:number,maxX:number,minY:number,maxY:number}} bounds
 * @param {number} spacing target edge length, mm
 * @returns {{x:number,y:number}[]}
 */
export function triangularLattice(bounds, spacing) {
  const s = Math.max(0.5, Number(spacing) || 10);
  const rowStep = (s * Math.sqrt(3)) / 2;
  const pts = [];
  const rows = [];
  let row = 0;
  for (let y = bounds.minY; y <= bounds.maxY + 1e-9; y += rowStep, row++) {
    rows.push({ y: Math.min(y, bounds.maxY), row });
  }
  // the loop can step past maxY (34.6 / 8.66 → last row 34.64): ensure the
  // far edge is always sampled by clamping a final row onto maxY
  const last = rows[rows.length - 1];
  if (!last || last.y < bounds.maxY - 1e-9) {
    // replace a near-miss row or append a clamped one
    if (last && bounds.maxY - last.y < rowStep * 0.35) last.y = round(bounds.maxY);
    else rows.push({ y: round(bounds.maxY), row: last ? last.row + 1 : 0 });
  }
  for (const { y, row: r } of rows) {
    const yy = round(y);
    const offset = r % 2 ? s / 2 : 0;
    for (let x = bounds.minX + offset; x <= bounds.maxX + 1e-9; x += s) {
      pts.push({ x: round(Math.min(x, bounds.maxX)), y: yy });
    }
  }
  return pts;
}
