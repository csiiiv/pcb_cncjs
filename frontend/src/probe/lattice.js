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
  // tolerate inverted bounds (min > max) — negative origins are now typeable
  const x0 = Math.min(bounds.minX, bounds.maxX);
  const x1 = Math.max(bounds.minX, bounds.maxX);
  const y0 = Math.min(bounds.minY, bounds.maxY);
  const y1 = Math.max(bounds.minY, bounds.maxY);
  const rowStep = (s * Math.sqrt(3)) / 2;
  const pts = [];
  const rows = [];
  let row = 0;
  for (let y = y0; y <= y1 + 1e-9; y += rowStep, row++) {
    rows.push({ y: Math.min(y, y1), row });
  }
  // the loop can step past the top edge (34.6 / 8.66 → last row 34.64): ensure
  // the far edge is always sampled by clamping a final row onto it
  const last = rows[rows.length - 1];
  if (!last || last.y < y1 - 1e-9) {
    if (last && y1 - last.y < rowStep * 0.35) last.y = round(y1);
    else rows.push({ y: round(y1), row: last ? last.row + 1 : 0 });
  }
  for (const { y, row: r } of rows) {
    const yy = round(y);
    const offset = r % 2 ? s / 2 : 0;
    for (let x = x0 + offset; x <= x1 + 1e-9; x += s) {
      pts.push({ x: round(Math.min(x, x1)), y: yy });
    }
  }
  return pts;
}
