// Probe mesh: vertices are authoritative, triangulation is derived (auto_level.md §4–5).
// Any add/remove re-triangulates; measured Z lives on the vertices and
// survives re-triangulation untouched.
import Delaunator from 'delaunator';

const key = (x, y) => `${Math.round(x * 100)}:${Math.round(y * 100)}`; // 0.01 mm

export function makeVertexId() {
  makeVertexId.n = (makeVertexId.n || 0) + 1;
  return makeVertexId.n;
}

/** Deduplicate points against each other (0.01 mm cell). */
export function dedupe(points) {
  const seen = new Set();
  const out = [];
  for (const p of points) {
    const k = key(p.x, p.y);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

/** Delaunay triangles as vertex-index triples. Empty below 3 vertices. */
export function triangulate(vertices) {
  if (vertices.length < 3) return [];
  const coords = new Float64Array(vertices.length * 2);
  vertices.forEach((v, i) => {
    coords[i * 2] = v.x;
    coords[i * 2 + 1] = v.y;
  });
  const delaunay = new Delaunator(coords);
  const tris = [];
  for (let t = 0; t < delaunay.triangles.length; t += 3) {
    tris.push([delaunay.triangles[t], delaunay.triangles[t + 1], delaunay.triangles[t + 2]]);
  }
  return tris;
}

function inTriangle(a, b, c, x, y) {
  const d1 = (x - b.x) * (a.y - b.y) - (a.x - b.x) * (y - b.y);
  const d2 = (x - c.x) * (b.y - c.y) - (b.x - c.x) * (y - c.y);
  const d3 = (x - a.x) * (c.y - a.y) - (c.x - a.x) * (y - a.y);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/** Index of the triangle containing (x,y), or -1 when outside the hull. */
export function locateTriangle(triangles, vertices, x, y) {
  for (let i = 0; i < triangles.length; i++) {
    const [a, b, c] = triangles[i];
    if (inTriangle(vertices[a], vertices[b], vertices[c], x, y)) return i;
  }
  return -1;
}

/**
 * Attach measured Z to vertices. Map priority: exact XY (0.01 mm), then the
 * nearest vertex within 0.05 mm. Returns the number matched.
 */
export function applyMeasurements(vertices, positions) {
  const byKey = new Map(vertices.map((v) => [key(v.x, v.y), v]));
  let matched = 0;
  for (const m of positions || []) {
    let v = byKey.get(key(m.x, m.y));
    if (!v) {
      let best = null;
      let bestD = 0.05 * 0.05;
      for (const cand of vertices) {
        const d = (cand.x - m.x) ** 2 + (cand.y - m.y) ** 2;
        if (d <= bestD) { bestD = d; best = cand; }
      }
      v = best;
    }
    if (!v) continue;
    v.z = Number(m.z);
    v.valid = m.valid !== false;
    matched++;
  }
  return matched;
}

/**
 * Coverage pre-check: whether a job's XY bounds lie inside the convex hull of
 * the probe vertices. Catches a too-small mesh BEFORE a physical probe pass —
 * compensation would otherwise reject out-of-hull cutting points only after
 * the whole surface was measured.
 * @returns {{covered:boolean, jobsOut:[{x:number,y:number}...]}} the 4 job
 *   corners that fall outside the hull (empty when covered)
 */
export function hullCoversBounds(vertices, bounds) {
  const missing = [];
  if (!vertices.length || !bounds) return { covered: false, missing };
  const corners = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.minX, y: bounds.maxY },
    { x: bounds.maxX, y: bounds.maxY }
  ];
  // A point is inside the hull when it is inside some triangle of the full
  // (not only fully-measured) triangulation — matches the surface's
  // interpolation domain.
  const triangles = triangulate(vertices);
  for (const c of corners) {
    const inside = triangles.some(([a, b, d]) =>
      inTriangle(vertices[a], vertices[b], vertices[d], c.x, c.y));
    if (!inside) missing.push(c);
  }
  return { covered: missing.length === 0, missing };
}
