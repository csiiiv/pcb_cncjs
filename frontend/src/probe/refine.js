// Refinement engine (auto_level.md §6–9). Candidate generation stays modular:
// the UI asks refineCandidates(...) and never picks coordinates itself.
// Strategies: centroid (robust fallback), longest-edge midpoint (elongated
// triangles), circumcenter (poorly shaped triangles; falls back to centroid
// when it lands outside the triangle or bounds).

const key = (x, y) => `${Math.round(x * 100)}:${Math.round(y * 100)}`;

function insideBounds(p, bounds) {
  return p.x >= bounds.minX - 1e-6 && p.x <= bounds.maxX + 1e-6 &&
         p.y >= bounds.minY - 1e-6 && p.y <= bounds.maxY + 1e-6;
}

function tooClose(p, vertices, minSpacing) {
  const d2 = minSpacing * minSpacing;
  return vertices.some((v) => (v.x - p.x) ** 2 + (v.y - p.y) ** 2 < d2);
}

function centroid(t) {
  return {
    x: (t.a.x + t.b.x + t.c.x) / 3,
    y: (t.a.y + t.b.y + t.c.y) / 3,
  };
}

function longestEdgeMidpoint(t) {
  const edges = [
    [t.a, t.b],
    [t.b, t.c],
    [t.c, t.a],
  ];
  let best = edges[0];
  let bestLen = -1;
  for (const e of edges) {
    const len = (e[0].x - e[1].x) ** 2 + (e[0].y - e[1].y) ** 2;
    if (len > bestLen) { bestLen = len; best = e; }
  }
  return { x: (best[0].x + best[1].x) / 2, y: (best[0].y + best[1].y) / 2 };
}

function circumcenter(t) {
  const d = 2 * (t.a.x * (t.b.y - t.c.y) + t.b.x * (t.c.y - t.a.y) + t.c.x * (t.a.y - t.b.y));
  if (Math.abs(d) < 1e-12) return null; // collinear
  const a2 = t.a.x ** 2 + t.a.y ** 2;
  const b2 = t.b.x ** 2 + t.b.y ** 2;
  const c2 = t.c.x ** 2 + t.c.y ** 2;
  return {
    x: (a2 * (t.b.y - t.c.y) + b2 * (t.c.y - t.a.y) + c2 * (t.a.y - t.b.y)) / d,
    y: (a2 * (t.c.x - t.b.x) + b2 * (t.a.x - t.c.x) + c2 * (t.b.x - t.a.x)) / d,
  };
}

function inOwnTriangle(p, t) {
  const d1 = (p.x - t.b.x) * (t.a.y - t.b.y) - (t.a.x - t.b.x) * (p.y - t.b.y);
  const d2 = (p.x - t.c.x) * (t.b.y - t.c.y) - (t.b.x - t.c.x) * (p.y - t.c.y);
  const d3 = (p.x - t.a.x) * (t.c.y - t.a.y) - (t.c.x - t.a.x) * (p.y - t.a.y);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/**
 * @param {object} opts
 * @param {[number,number,number]} opts.indices triangle vertex indices
 * @param {object[]} opts.vertices mesh vertices
 * @param {object} opts.bounds {minX,maxX,minY,maxY}
 * @param {'auto'|'centroid'|'longest-edge'|'circumcenter'} [opts.strategy]
 * @param {number} [opts.minSpacing] reject candidates closer than this to any vertex
 * @returns {{x:number,y:number}[]} accepted candidates (0 or 1 in this version)
 */
export function refineCandidates({
  indices,
  vertices,
  bounds,
  strategy = 'auto',
  minSpacing = 1.5,
}) {
  const [ia, ib, ic] = indices;
  const t = { a: vertices[ia], b: vertices[ib], c: vertices[ic] };
  const area2 = Math.abs(
    (t.b.x - t.a.x) * (t.c.y - t.a.y) - (t.c.x - t.a.x) * (t.b.y - t.a.y)
  );

  let pick;
  if (strategy === 'centroid') {
    pick = centroid(t);
  } else if (strategy === 'longest-edge') {
    pick = longestEdgeMidpoint(t);
  } else if (strategy === 'circumcenter') {
    const cc = circumcenter(t);
    // circumcenters of obtuse triangles land far outside; only accept when the
    // candidate stays inside its own triangle (well-shaped case)
    pick = cc && inOwnTriangle(cc, t) ? cc : centroid(t);
  } else {
    // auto: elongated triangles gain most from splitting the longest edge;
    // the height relative to that edge drops below half its length
    let maxLen2 = 0;
    for (const [p, q] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) {
      maxLen2 = Math.max(maxLen2, (p.x - q.x) ** 2 + (p.y - q.y) ** 2);
    }
    const maxLen = Math.sqrt(maxLen2);
    const height = area2 / (2 * Math.max(maxLen, 1e-9)); // area = base·height/2
    pick = maxLen / Math.max(height, 1e-9) > 2.2 ? longestEdgeMidpoint(t) : centroid(t);
  }

  if (!Number.isFinite(pick.x) || !Number.isFinite(pick.y)) return [];
  if (!insideBounds(pick, bounds)) return [];
  if (tooClose(pick, vertices, minSpacing)) return [];
  return [pick];
}

/** Vertex keys already present — helper for callers building add lists. */
export function existingKeys(vertices) {
  return new Set(vertices.map((v) => key(v.x, v.y)));
}
