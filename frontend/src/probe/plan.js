// Variable-density probe map.
// Base grid over the PCB bounds, tighter points inside rectangles, plus
// hand-placed points. Duplicates closer than `tolerance` collapse to one.

const round = (v) => Math.round(v * 1000) / 1000;

function axisValues(start, end, step) {
  const s = Math.min(start, end);
  const e = Math.max(start, end);
  const d = Math.max(0.1, step);
  const n = Math.max(0, Math.floor((e - s) / d + 1e-6));
  const values = [];
  for (let i = 0; i <= n; i++) values.push(round(s + i * d));
  if (values.length === 0 || Math.abs(values[values.length - 1] - e) > 0.001) {
    values.push(round(e));
  }
  return values;
}

/**
 * @param {object} opts
 * @param {{minX:number,maxX:number,minY:number,maxY:number}} opts.bounds
 * @param {number} opts.spacing base grid spacing, mm
 * @param {{x:number,y:number,w:number,h:number,spacing:number}[]} [opts.regions]
 * @param {{x:number,y:number}[]} [opts.manual]
 * @param {number} [opts.tolerance] duplicate radius, mm
 * @returns {{x:number,y:number,kind:'grid'|'dense'|'manual'}[]}
 */
export function buildProbePlan({
  bounds,
  spacing,
  regions = [],
  manual = [],
  tolerance = 0.05,
}) {
  const raw = [];
  for (const y of axisValues(bounds.minY, bounds.maxY, spacing)) {
    for (const x of axisValues(bounds.minX, bounds.maxX, spacing)) {
      raw.push({ x, y, kind: 'grid' });
    }
  }
  for (const region of regions) {
    const x0 = region.x;
    const y0 = region.y;
    const x1 = region.x + region.w;
    const y1 = region.y + region.h;
    for (const y of axisValues(y0, y1, region.spacing)) {
      for (const x of axisValues(x0, x1, region.spacing)) {
        raw.push({ x, y, kind: 'dense' });
      }
    }
  }
  for (const p of manual) {
    if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
      raw.push({ x: round(p.x), y: round(p.y), kind: 'manual' });
    }
  }

  const cell = Math.max(tolerance, 0.001);
  const seen = new Set();
  const unique = [];
  for (const p of raw) {
    const key = `${Math.round(p.x / cell)}:${Math.round(p.y / cell)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }

  // Serpentine rows so the probe head doesn't retrace the full width.
  unique.sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const p of unique) {
    const last = rows[rows.length - 1];
    if (!last || Math.abs(last.y - p.y) > tolerance) rows.push({ y: p.y, pts: [p] });
    else last.pts.push(p);
  }
  const ordered = [];
  rows.forEach((row, i) => {
    ordered.push(...(i % 2 ? [...row.pts].reverse() : row.pts));
  });
  return ordered;
}
