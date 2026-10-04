// Linear Delaunay surface — the trusted baseline (auto_level.md §11).
// Barycentric interpolation inside fully-measured triangles; null anywhere
// else (unmeasured triangle or outside the probe hull) so downstream
// compensation can refuse to extrapolate.
export function buildSurface(vertices, triangles) {
  const usable = [];
  for (const t of triangles) {
    const [A, B, C] = t.map((i) => vertices[i]);
    if (A && B && C && [A, B, C].every((v) => Number.isFinite(Number(v.z)))) {
      usable.push([A, B, C]);
    }
  }

  const getZ = (x, y) => {
    for (const [A, B, C] of usable) {
      const d = (B.y - C.y) * (A.x - C.x) + (C.x - B.x) * (A.y - C.y);
      if (Math.abs(d) < 1e-12) continue;
      const wA = ((B.y - C.y) * (x - C.x) + (C.x - B.x) * (y - C.y)) / d;
      if (wA < -1e-9 || wA > 1 + 1e-9) continue;
      const wB = ((C.y - A.y) * (x - C.x) + (A.x - C.x) * (y - C.y)) / d;
      if (wB < -1e-9 || wB > 1 + 1e-9) continue;
      const wC = 1 - wA - wB;
      if (wC < -1e-9) continue;
      return wA * A.z + wB * B.z + wC * C.z;
    }
    return null;
  };

  return {
    getZ,
    triangles: usable,
    get triangleCount() { return usable.length; },
    get measuredVertices() {
      return vertices.filter((v) => Number.isFinite(Number(v.z))).length;
    },
  };
}
