// Heightmap save/load + reproducibility comparison (auto_level.md §11).
// A snapshot = probe mesh vertices (measured) + metadata. JSON format v1:
// {
//   format: 'pcb-cnc-heightmap', version: 1,
//   name, createdAt, bounds: {minX,maxX,minY,maxY}, spacing,
//   points: [{ x, y, z, manual? }]
// }

const MAGIC = 'pcb-cnc-heightmap';
const VERSION = 1;

/** Serialize measured probe vertices to a heightmap object. */
export function serializeHeightmap({ name, bounds, spacing, vertices }) {
  const points = vertices
    .filter((v) => Number.isFinite(Number(v.z)))
    .map((v) => {
      const p = { x: v.x, y: v.y, z: Number(v.z) };
      if (v.manual) p.manual = true;
      return p;
    });
  return {
    format: MAGIC,
    version: VERSION,
    name: name || `heightmap-${new Date().toISOString().slice(0, 19).replace('T', ' ')}`,
    createdAt: new Date().toISOString(),
    bounds: bounds || null,
    spacing: spacing ?? null,
    points,
  };
}

/** Parse + validate a heightmap object. Throws on bad data. */
export function parseHeightmap(data) {
  if (!data || data.format !== MAGIC) throw new Error('not a pcb-cnc heightmap file');
  if (data.version !== VERSION) throw new Error(`unsupported heightmap version ${data.version}`);
  const raw = Array.isArray(data.points) ? data.points : [];
  const points = raw
    .map((p) => ({ x: Number(p.x), y: Number(p.y), z: Number(p.z), manual: !!p.manual }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
  if (points.length < 3) throw new Error('heightmap has fewer than 3 measured points');
  return {
    name: typeof data.name === 'string' ? data.name : 'unnamed',
    createdAt: data.createdAt,
    bounds: data.bounds || null,
    spacing: data.spacing ?? null,
    points,
  };
}

/** Trigger a browser download of the heightmap as JSON. */
export function downloadHeightmap(hm) {
  const blob = new Blob([JSON.stringify(hm, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safe = (hm.name || 'heightmap').replace(/[^\w.-]+/g, '_');
  a.href = url;
  a.download = `${safe}.heightmap.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// --- comparison (reproducibility) -------------------------------------------

/**
 * Compare two heightmaps point-by-point. Points are matched by nearest
 * neighbor within `tolerance` mm (grids may drift between runs).
 * Returns stats + per-point deltas.
 */
export function compareHeightmaps(a, b, tolerance = 0.5) {
  const grid = new Map(); // spatial hash for fast NN lookup
  const cell = Math.max(tolerance, 0.01);
  const kOf = (x, y) => `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
  for (const p of b.points) {
    const k = kOf(p.x, p.y);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  }
  const pairs = [];
  const unmatchedA = [];
  for (const p of a.points) {
    let best = null;
    let bestD2 = tolerance * tolerance;
    const cx = Math.floor(p.x / cell);
    const cy = Math.floor(p.y / cell);
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        for (const q of grid.get(`${cx + ox}:${cy + oy}`) || []) {
          const d2 = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
          if (d2 < bestD2) { bestD2 = d2; best = q; }
        }
      }
    }
    if (best) pairs.push({ a: p, b: best, dz: p.z - best.z });
    else unmatchedA.push(p);
  }
  const dzs = pairs.map((p) => p.dz);
  const n = dzs.length;
  const mean = n ? dzs.reduce((s, v) => s + v, 0) / n : 0;
  const variance = n ? dzs.reduce((s, v) => s + (v - mean) ** 2, 0) / n : 0;
  const sorted = [...dzs].sort((x, y) => x - y);
  const quantile = (q) => (n ? sorted[Math.min(n - 1, Math.floor(q * n))] : 0);
  return {
    matched: n,
    unmatchedA: unmatchedA.length,
    unmatchedB: b.points.length - n,
    mean,
    std: Math.sqrt(variance),
    rms: n ? Math.sqrt(dzs.reduce((s, v) => s + v * v, 0) / n) : 0,
    min: n ? sorted[0] : 0,
    max: n ? sorted[n - 1] : 0,
    p05: quantile(0.05),
    p95: quantile(0.95),
    pairs,
  };
}
