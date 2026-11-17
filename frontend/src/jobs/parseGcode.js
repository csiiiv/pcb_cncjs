// Structured G-code job model (brief §15–16).
//
// G-code text → { paths[], rapidMoves[], bounds, stats }
//
// paths[] are LOGICAL cutting paths: a rapid retract begins a new path, so each
// plunge → cut → retract group becomes one path of contiguous segments. This is
// the structure selective re-machining (Phase 11) will operate on.
//
// Each segment keeps its source line so visualizer clicks can trace back to the
// original G-code (brief §20).

const MOTION = { RAPID: 'G0', LINE: 'G1', CW_ARC: 'G2', CCW_ARC: 'G3' };

// Tool-width comments give the visualizer the effective cutting diameter in
// millimetres. pcb2gcode emits "(MSG, Change tool bit to mill diameter
// 0.20000mm)" / "cutter diameter 1.00000mm" / "drill size 0.8mm"; the tool-test
// generator emits "(Reference 2: Z-0.05 / estimated width 0.157 mm)" per
// groove. A comment applies to every path that starts after it: widths are
// constant per path (a V-bit's width differs between paths cut at different
// depths), which is exactly how pcb2gcode and the coupon generator emit them.
const WIDTH_COMMENT = /(mill diameter|cutter diameter|drill size|estimated width)\s+([0-9]*\.?[0-9]+)\s*mm/i;
const MAX_SANE_WIDTH = 25; // mm — guards stray matches from unrelated comments

export function stripComments(line) {
  // remove () comments and ; to-end-of-line comments
  return line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
}

function parseWords(code) {
  // "G1 X10.5 Y-3 Z0.1 F100" -> { G: ['1'], X: 10.5, Y: -3, ... }
  const words = {};
  const re = /([A-Za-z])\s*([-+]?[0-9]*\.?[0-9]+)/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const letter = m[1].toUpperCase();
    const value = m[2];
    if (letter === 'G' || letter === 'M') {
      (words[letter] ||= []).push(String(Number(value))); // G00/G01 are G0/G1
    } else {
      words[letter] = Number(value);
    }
  }
  return words;
}

function arcCenter(start, end, words, clockwise) {
  // IJ form: center offset relative to start (GRBL/pcb2gcode style, mm)
  if (words.I !== undefined || words.J !== undefined) {
    return {
      x: start.x + (words.I || 0),
      y: start.y + (words.J || 0),
      r: Math.hypot(words.I || 0, words.J || 0)
    };
  }
  // R form: center from radius + endpoints (choose minor arc per direction)
  if (words.R !== undefined) {
    const r = Math.abs(words.R);
    const mx = (start.x + end.x) / 2;
    const my = (start.y + end.y) / 2;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const d = Math.hypot(dx, dy);
    if (d === 0 || d > 2 * r) return null;
    const h = Math.sqrt(Math.max(0, r * r - (d / 2) * (d / 2)));
    // normal pointing to the minor-arc center
    let sign = clockwise ? 1 : -1;
    if (words.R < 0) sign = -sign; // negative R selects major arc
    return {
      x: mx - sign * (dy / d) * h,
      y: my + sign * (dx / d) * h,
      r
    };
  }
  return null;
}

export function parseGcode(sourceText) {
  const lines = String(sourceText).split(/\r?\n/);

  // modal state
  let motionMode = null; // 'G0' | 'G1' | 'G2' | 'G3' (sticky)
  let absolute = true; // G90
  let units = 'G21';
  let plane = 'G17';
  let feed = 0;
  let current = { x: 0, y: 0, z: 0 }; // tracked machine-agnostic position (work coords)
  let lineNo = 0;

  const paths = [];
  const rapidMoves = [];
  let pathId = 0;
  let segmentId = 0;
  let pendingWidth = null; // tool width from the last width comment

  const bounds = {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity }
  };
  const grow = (p) => {
    bounds.min.x = Math.min(bounds.min.x, p.x);
    bounds.min.y = Math.min(bounds.min.y, p.y);
    bounds.min.z = Math.min(bounds.min.z, p.z);
    bounds.max.x = Math.max(bounds.max.x, p.x);
    bounds.max.y = Math.max(bounds.max.y, p.y);
    bounds.max.z = Math.max(bounds.max.z, p.z);
  };
  grow(current);

  for (const rawLine of lines) {
    lineNo++;

    const widthMatch = rawLine.match(WIDTH_COMMENT);
    if (widthMatch && Number(widthMatch[2]) <= MAX_SANE_WIDTH) {
      pendingWidth = Number(widthMatch[2]);
    }

    const code = stripComments(rawLine);
    if (!code) continue;
    if (/^%/.test(code)) continue; // program markers

    const words = parseWords(code);

    // --- non-motion words ---
    if (words.F !== undefined) feed = words.F;
    if (words.G) {
      for (const g of words.G) {
        if (g === '0' || g === '1' || g === '2' || g === '3') motionMode = MOTION[g === '0' ? 'RAPID' : g === '1' ? 'LINE' : g === '2' ? 'CW_ARC' : 'CCW_ARC'];
        else if (g === '90') absolute = true;
        else if (g === '91') absolute = false;
        else if (g === '20') units = 'G20';
        else if (g === '21') units = 'G21';
        else if (g === '17' || g === '18' || g === '19') plane = `G${g}`;
      }
    }
    // M codes (spindle etc.) don't affect geometry here — skipped in Phase 3
    if (words.M) {
      if (words.G === undefined && words.X === undefined && words.Y === undefined && words.Z === undefined) continue;
    }
    const hasAxis = words.X !== undefined || words.Y !== undefined || words.Z !== undefined;
    if (!hasAxis) continue; // pure modal/settings line
    if (motionMode === null) continue; // axis words before any motion mode

    // --- target position ---
    const target = {
      x: words.X !== undefined ? (absolute ? words.X : current.x + words.X) : current.x,
      y: words.Y !== undefined ? (absolute ? words.Y : current.y + words.Y) : current.y,
      z: words.Z !== undefined ? (absolute ? words.Z : current.z + words.Z) : current.z
    };

    const isRapid = motionMode === MOTION.RAPID;
    const isArc = motionMode === MOTION.CW_ARC || motionMode === MOTION.CCW_ARC;

    if (isRapid) {
      // Rapids are not part of cutting paths; record for the rapid overlay.
      // Long XY/Z rapids also implicitly END the current cutting path.
      rapidMoves.push({
        id: rapidMoves.length,
        start: { ...current },
        end: { ...target },
        sourceLine: lineNo
      });
      // (path splitting happens lazily on next cutting move)
    } else {
      // Cutting move (line or arc) — always belongs to a path.
      // New path if the previous move was a rapid (plunge after retract/positioning)
      // or there is no open path.
      let p = paths[paths.length - 1];
      const lastWasRapid =
        rapidMoves.length > 0 &&
        p &&
        p.segments.length > 0 &&
        rapidMoves[rapidMoves.length - 1].sourceLine > p.segments[p.segments.length - 1].sourceLine;

      if (!p || lastWasRapid) {
        pathId++;
        p = { id: pathId, segments: [], sourceLine: lineNo, feed, depth: target.z, cutWidth: pendingWidth };
        paths.push(p);
      }

      const segment = {
        id: segmentId++,
        pathId: p.id,
        type: isArc ? 'arc' : 'line',
        start: { ...current },
        end: { ...target },
        motion: motionMode,
        feed,
        sourceLine: lineNo
      };

      if (isArc && plane === 'G17') {
        const center = arcCenter(current, target, words, motionMode === MOTION.CW_ARC);
        if (center) {
          segment.center = { x: center.x, y: center.y };
          segment.radius = center.r;
          segment.clockwise = motionMode === MOTION.CW_ARC;
        } else {
          // malformed arc: degrade to a straight line rather than lose the move
          segment.type = 'line';
        }
      } else if (isArc) {
        // G18/G19 arcs not needed for pcb2gcode output; degrade to line for now
        segment.type = 'line';
      }

      p.segments.push(segment);
      p.depth = target.z;
    }

    current = target;
    grow(current);
  }

  const stats = {
    totalLines: lines.length,
    gcodeLines: lines.filter((l) => stripComments(l)).length,
    paths: paths.length,
    cutSegments: paths.reduce((n, p) => n + p.segments.length, 0),
    rapids: rapidMoves.length
  };

  return { paths, rapidMoves, bounds, stats, units };
}

// Total path length (for the selection panel in Phase 4)
export function pathLength(path) {
  let len = 0;
  for (const s of path.segments) {
    if (s.type === 'arc' && s.center) {
      const a0 = Math.atan2(s.start.y - s.center.y, s.start.x - s.center.x);
      const a1 = Math.atan2(s.end.y - s.center.y, s.end.x - s.center.x);
      let sweep = a1 - a0;
      if (s.clockwise && sweep > 0) sweep -= 2 * Math.PI;
      if (!s.clockwise && sweep < 0) sweep += 2 * Math.PI;
      len += Math.abs(sweep) * s.radius;
    } else {
      len += Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y, s.end.z - s.start.z);
    }
  }
  return len;
}
