// G-code Z compensation against the measured Delaunay surface (auto_level.md §12–14).
//
//   commandedZ(x,y) = nominalZ + surfaceZ(x,y)
//
// - cutting moves (G1/G2/G3) are subdivided to maxSegLen so the tool follows
//   the surface between endpoints; arcs become compensated polylines
// - rapids (G0) pass through unchanged — retracts must not chase the surface
// - probe / dwell / offset / canned lines (G38, G4, G10, G5x, G92) pass through
// - any cutting point the surface can't interpolate is collected in `outside`;
//   the caller must refuse to run a job with outside points (no extrapolation)
import { buildSurface } from './surface.js';

const WORD_RE = /([A-Za-z])\s*([-+]?\d*\.?\d+)/g;

const fmt = (n) => {
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(3) : '0';
};

function arcPoints(start, end, { cw, i, j, r }) {
  // center from I/J (relative to start) or R form
  let cx;
  let cy;
  if (i != null || j != null) {
    cx = start.x + (i || 0);
    cy = start.y + (j || 0);
  } else if (r != null) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const chord = Math.hypot(dx, dy);
    if (chord < 1e-9 || chord > 2 * Math.abs(r) + 1e-9) return null;
    const h = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2));
    const mx = (start.x + end.x) / 2;
    const my = (start.y + end.y) / 2;
    const ux = -dy / chord;
    const uy = dx / chord;
    // two candidate centers; pick by arc direction and R sign
    const sign = (r >= 0) === cw ? -1 : 1;
    cx = mx + sign * h * ux;
    cy = my + sign * h * uy;
  } else {
    return null;
  }

  const radius = Math.hypot(start.x - cx, start.y - cy);
  let a0 = Math.atan2(start.y - cy, start.x - cx);
  let a1 = Math.atan2(end.y - cy, end.x - cx);
  let sweep = a1 - a0;
  if (cw && sweep > 0) sweep -= 2 * Math.PI;
  if (!cw && sweep < 0) sweep += 2 * Math.PI;
  if (cw && sweep === 0) sweep = -2 * Math.PI; // full circle
  if (!cw && sweep === 0) sweep = 2 * Math.PI;

  const length = Math.abs(sweep) * radius;
  const steps = Math.max(8, Math.ceil(length / 2));
  const pts = [];
  for (let s = 1; s <= steps; s++) {
    const a = a0 + (sweep * s) / steps;
    pts.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
  }
  return pts;
}

/**
 * @param {object} opts
 * @param {string} opts.text job g-code
 * @param {ReturnType<buildSurface>} opts.surface measured linear surface
 * @param {number} [opts.maxSegLen] max compensated cutting segment, mm
 * @returns {{text:string, outside:{x,y,line}[], subdivided:number}}
 */
export function compensateGcode({ text, surface, maxSegLen = 2 }) {
  const lines = String(text).split(/\r?\n/);
  const out = [];
  const outside = [];
  let subdivided = 0;

  let pos = null; // {x,y,z} — known after the first absolute X/Y move
  let motion = 0; // last motion mode (0/1/2/3)
  let absolute = true;
  let feed = null;

  const emitCut = (from, to, lineNo, f) => {
    // absolute-ify endpoints already done by caller; subdivide + compensate
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = (to.z ?? from.z ?? 0) - (from.z ?? 0);
    // pure vertical plunge/retract: XY fixed → surface constant, one segment
    const dist2d = Math.hypot(dx, dy);
    const steps = dist2d < 1e-9
      ? 1
      : Math.max(1, Math.min(200, Math.ceil(Math.hypot(dx, dy, dz) / Math.max(0.1, maxSegLen))));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const x = from.x + dx * t;
      const y = from.y + dy * t;
      const nominalZ = (from.z ?? 0) + dz * t;
      const sz = surface.getZ(x, y);
      if (sz == null) {
        outside.push({ x, y, line: lineNo });
        return; // stop compensating this move; geometry unsupported here
      }
      out.push(`G1 X${fmt(x)} Y${fmt(y)} Z${fmt(nominalZ + sz)}${f != null ? ` F${fmt(f)}` : ''}`);
      subdivided += steps > 1 ? 1 : 0;
    }
  };

  lines.forEach((raw, idx) => {
    const lineNo = idx + 1;
    const code = raw.replace(/\(.*?\)/g, '').replace(/;.*$/, '').trim();
    if (!code || code.startsWith('%')) {
      out.push(raw);
      return;
    }

    const words = [];
    WORD_RE.lastIndex = 0;
    let m;
    while ((m = WORD_RE.exec(code))) words.push([m[1].toUpperCase(), m[2]]);

    let g = null;
    const coords = {};
    let f = null;
    for (const [L, v] of words) {
      if (L === 'G') g = Number(v);
      else if (L === 'F') f = Number(v);
      else if (L === 'N' || L === 'T' || L === 'S') continue;
      else coords[L] = Number(v); // X Y Z I J R
    }
    if (f != null) feed = f;

    if (g === 90) { absolute = true; out.push(raw); return; }
    if (g === 91) { absolute = false; out.push(raw); return; }
    if (g === 20 || g === 21 || g === 17 || g === 18 || g === 19 ||
        g === 54 || g === 55 || g === 56 || g === 57 || g === 58 || g === 59) {
      out.push(raw);
      return;
    }
    // pass-through: rapid-probe, dwell, offsets, cubic splines, canned, M-codes
    if (g === 0) {
      motion = 0;
      const nx = coords.X ?? (absolute ? pos?.x : (pos?.x ?? 0) + (coords.X ?? 0));
      // update position (absolute or relative) without compensation
      const relX = coords.X != null ? (absolute ? coords.X : (pos?.x ?? 0) + coords.X) : pos?.x;
      const relY = coords.Y != null ? (absolute ? coords.Y : (pos?.y ?? 0) + coords.Y) : pos?.y;
      const relZ = coords.Z != null ? (absolute ? coords.Z : (pos?.z ?? 0) + coords.Z) : pos?.z;
      if (relX != null || relY != null || relZ != null) {
        pos = { x: relX ?? pos?.x ?? 0, y: relY ?? pos?.y ?? 0, z: relZ ?? pos?.z ?? 0 };
      }
      out.push(raw);
      return;
    }
    if ((g != null && (g === 1 || g === 2 || g === 3))) motion = g;
    if (g != null && !Number.isInteger(g)) { // G38.2 etc.
      out.push(raw);
      return;
    }
    if (g === 4 || g === 10 || g === 40 || g === 49 || g === 43 || (g >= 53 && g <= 59) ||
        g === 61 || g === 64 || g === 80 || g === 90 || g === 91 || (g >= 92 && g <= 94) || g === 28) {
      out.push(raw);
      return;
    }
    if (coords.X == null && coords.Y == null && coords.Z == null && coords.I == null && coords.J == null && coords.R == null) {
      out.push(raw); // pure F/M line or comment-only
      return;
    }

    const isCut = (g === 1 || (g == null && motion === 1)) ||
                  (g === 2 || g === 3 || (g == null && (motion === 2 || motion === 3)));

    // resolve the absolute end position
    const end = {
      x: coords.X != null ? (absolute ? coords.X : (pos?.x ?? 0) + coords.X) : pos?.x,
      y: coords.Y != null ? (absolute ? coords.Y : (pos?.y ?? 0) + coords.Y) : pos?.y,
      z: coords.Z != null ? (absolute ? coords.Z : (pos?.z ?? 0) + coords.Z) : pos?.z,
    };
    const arcMode = g === 2 || g === 3 || (g == null && (motion === 2 || motion === 3));

    if (!isCut || pos == null || end.x == null || end.y == null) {
      // not a compensatable cut (or start unknown): track and pass through
      if (end.x != null || end.y != null || end.z != null) {
        pos = { x: end.x ?? pos?.x ?? 0, y: end.y ?? pos?.y ?? 0, z: end.z ?? pos?.z ?? 0 };
      }
      out.push(raw);
      return;
    }

    if (arcMode) {
      const pts = arcPoints(pos, end, {
        cw: (g ?? motion) === 2,
        i: coords.I,
        j: coords.J,
        r: coords.R,
      });
      if (!pts) {
        outside.push({ x: end.x, y: end.y, line: lineNo });
        out.push(raw);
        pos = { ...end };
        return;
      }
      let from = { ...pos };
      let first = true;
      for (const p of pts) {
        const to = { x: p.x, y: p.y, z: end.z ?? pos.z ?? 0 };
        emitCut(from, to, lineNo, first ? (f ?? feed) : null);
        from = to;
        first = false;
      }
      pos = { ...end, z: end.z ?? pos.z ?? 0 };
      return;
    }

    // straight cut
    const from = { ...pos };
    emitCut(from, end, lineNo, f ?? feed);
    pos = { ...end };
  });

  return { text: out.join('\n'), outside, subdivided };
}
