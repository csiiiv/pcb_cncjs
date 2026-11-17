// Three.js toolpath visualizer (brief §17–21).
// Renders parsed job geometry as selectable BufferGeometry lines:
//   - cutting paths: colored, raycastable, metadata-linked (operation/path/segment)
//   - rapids: dim dashed overlay, non-selectable
//   - grid + work origin axes
//   - tool position marker (live, from machine state)
import * as THREE from 'three';
import { colormapRGB } from '../probe/colormap.js';
import { VIEWER_LAYERS } from './layers.js';
export const PATH_COLORS = [0x4f9cf9, 0x3ecf8e, 0xf5a623, 0xd977f5, 0x22d3ee, 0xf472b6];

function segToPoints(s) {
  if (s.type === 'arc' && s.center) {
    const a0 = Math.atan2(s.start.y - s.center.y, s.start.x - s.center.x);
    const a1 = Math.atan2(s.end.y - s.center.y, s.end.x - s.center.x);
    let sweep = a1 - a0;
    if (s.clockwise && sweep > 0) sweep -= 2 * Math.PI;
    if (!s.clockwise && sweep < 0) sweep += 2 * Math.PI;
    const steps = Math.max(8, Math.ceil((Math.abs(sweep) * s.radius) / 0.2));
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (sweep * i) / steps;
      pts.push(new THREE.Vector3(
        s.center.x + s.radius * Math.cos(a),
        s.center.y + s.radius * Math.sin(a),
        s.start.z
      ));
    }
    return pts;
  }
  return [
    new THREE.Vector3(s.start.x, s.start.y, s.start.z),
    new THREE.Vector3(s.end.x, s.end.y, s.end.z)
  ];
}

// Flat ribbon along a 3D polyline at half-width halfW, offset in XY so it hugs
// sloped (compensated) Z. Miter joins absorb direction changes at interior
// points; very sharp corners fall back to bevel to avoid extreme miters.
// Vertical hops (plunges between depth passes) emit a cross-section from the
// adjacent XY direction, so the strip stays continuous through multi-pass cuts.
export function ribbonGeometry(points, halfW) {
  const positions = [];
  const indices = [];
  const count = points.length;
  for (let i = 0; i < count; i++) {
    const p = points[i];
    const prev = points[i - 1] ?? p;
    const next = points[i + 1] ?? p;
    const d1x = p.x - prev.x, d1y = p.y - prev.y;
    const d2x = next.x - p.x, d2y = next.y - p.y;
    const l1 = Math.hypot(d1x, d1y);
    const l2 = Math.hypot(d2x, d2y);
    let nx, ny; // XY normal offset (already scaled by halfW)
    if (l1 < 1e-6 && l2 < 1e-6) continue; // pure vertical hop / duplicate
    if (i === 0 || l1 < 1e-6) {
      // strip start (or first point after a vertical hop): use outgoing direction
      nx = (-d2y / l2) * halfW; ny = (d2x / l2) * halfW;
    } else if (i === count - 1 || l2 < 1e-6) {
      // strip end (or last point before a vertical hop): incoming direction
      nx = (-d1y / l1) * halfW; ny = (d1x / l1) * halfW;
    } else {
      const n1x = -d1y / l1, n1y = d1x / l1;
      const n2x = -d2y / l2, n2y = d2x / l2;
      const mx = n1x + n2x, my = n1y + n2y;
      const m = Math.hypot(mx, my);
      if (m < 1e-6) continue; // 180° reversal
      const cos = mx * n1x + my * n1y; // cos(half corner angle)
      if (cos < 0.35) {
        // bevel: cap the offset at halfW along the averaged direction
        nx = (mx / m) * halfW; ny = (my / m) * halfW;
      } else {
        const scale = halfW / cos;
        nx = mx * scale; ny = my * scale;
      }
    }
    positions.push(p.x + nx, p.y + ny, p.z, p.x - nx, p.y - ny, p.z);
    const base = positions.length / 3 - 2;
    if (base >= 2) indices.push(base - 2, base - 1, base, base - 1, base + 1, base);
  }
  if (positions.length < 12) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  return geo;
}

export class ToolpathScene {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0e1116);

    this.persp = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 5000);
    this.camera = this.persp; // ISO / orbit; top and side presets swap in ortho
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    // simple orbit controls (no external deps): LMB orbit, RMB pan, wheel zoom
    this.#setupOrbit();

    this.toolpathGroup = new THREE.Group();
    this.rapidGroup = new THREE.Group();
    this.overlayGroup = new THREE.Group(); // grid, axes, tool marker
    this.scene.add(this.toolpathGroup, this.rapidGroup, this.overlayGroup);
    // Stable parents retain layer visibility when data/markers are rebuilt.
    this.layerGroups = { toolpaths: this.toolpathGroup, rapids: this.rapidGroup };
    for (const { id } of VIEWER_LAYERS) {
      if (this.layerGroups[id]) continue;
      const group = new THREE.Group();
      group.name = id;
      this.layerGroups[id] = group;
      this.overlayGroup.add(group);
    }

    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Line = { threshold: 0.3 };

    this.selectedPathId = null;
    this.hiddenPathIds = new Set();
    this.pathObjects = new Map(); // pathId -> { line, segments: Map(segId -> line) }
    this.swathGroup = new THREE.Group();
    this.layerGroups.swath.add(this.swathGroup);
    this.showSwath = false;
    this.onSelect = null; // (selection | null) => void
    this.onHover = null;

    // probe display prefs (driven by viz store prefs)
    this.probeColormap = 'blue-red';
    this.showZLabels = false;

    this.#buildOverlay();
    this.#bindEvents();

    // frame the default ±100mm workspace so the empty viewer is oriented
    this.camera.position.set(140, -140, 110);
    this.camera.lookAt(0, 0, 0);
    this.orbit.target.set(0, 0, 0);

    this.clock = new THREE.Clock();
    this.#animate();
  }

  // --- public API ---

  setLayerVisibility(id, visible) {
    const group = this.layerGroups[id];
    if (group) group.visible = Boolean(visible);
  }

  setJob(job, { frame = true } = {}) {
    this.clearJob();
    this.job = job || null;
    if (!job) return;
    this.hiddenPathIds.clear();
    if (this.rulerGroup) this.#buildRulers(job.bounds);

    let swathCount = 0;
    for (const path of job.paths) {
      const color = PATH_COLORS[(path.id - 1) % PATH_COLORS.length];
      const segments = new Map();

      // one line object per segment: per-segment highlight without re-chunking
      for (const seg of path.segments) {
        const geo = new THREE.BufferGeometry().setFromPoints(segToPoints(seg));
        // dashed when a cut width is known — the ribbon then carries the
        // "this is the path" signal and the centre line reads as an axis
        const mat = this.showSwath && path.cutWidth != null
          ? new THREE.LineDashedMaterial({ color, dashSize: 0.6, gapSize: 0.4 })
          : new THREE.LineBasicMaterial({ color });
        const line = new THREE.Line(geo, mat);
        if (mat.isLineDashedMaterial) line.computeLineDistances();
        line.userData = {
          type: 'toolpath-segment',
          operationId: job.operationId ?? path.operationId ?? null,
          pathId: path.id,
          segmentId: seg.id,
          sourceLine: seg.sourceLine,
          motion: seg.motion
        };
        this.toolpathGroup.add(line);
        segments.set(seg.id, line);
      }

      // cut-width ribbon (actual swept cut area at the path's depth)
      if (this.showSwath && Number.isFinite(path.cutWidth) && path.cutWidth > 0) {
        const pts = path.segments.flatMap(segToPoints);
        const geo = ribbonGeometry(pts, path.cutWidth / 2);
        if (geo) {
          const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
            color, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false
          }));
          mesh.userData = { type: 'cut-swath', pathId: path.id };
          mesh.renderOrder = 1;
          this.swathGroup.add(mesh);
          swathCount++;
        } else {
          // pure-vertical paths (drilled holes) get a hole disc at the surface
          for (const seg of path.segments) {
            if (Math.hypot(seg.end.x - seg.start.x, seg.end.y - seg.start.y) <= 1e-6 && seg.end.z < 0) {
              const disc = new THREE.Mesh(
                new THREE.CircleGeometry(path.cutWidth / 2, 24),
                new THREE.MeshBasicMaterial({
                  color, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false
                })
              );
              // the hole reads at the board surface, just above grid/tints
              disc.position.set(seg.start.x, seg.start.y, 0.02);
              disc.userData = { type: 'cut-swath', pathId: path.id };
              disc.renderOrder = 1;
              this.swathGroup.add(disc);
              swathCount++;
            }
          }
        }
      }

      this.pathObjects.set(path.id, {
        color: new THREE.Color(color),
        segments,
        swathMeshes: this.swathGroup.children.filter((m) => m.userData.pathId === path.id)
      });
    }
    this.swathCount = swathCount;
    this.applyVisibility();
    if (frame) this.frameJob(job);
  }

  /** Toggle the actual-cut-width ribbon overlay (dashed centre lines when on).
   *  Rebuilds path geometry so centre lines swap solid ↔ dashed; selection,
   *  hidden paths and camera framing are preserved. */
  setShowSwath(show) {
    const next = !!show;
    if (next === this.showSwath) return;
    this.showSwath = next;
    this.swathGroup.visible = next;
    if (!this.job) return;
    const hidden = new Set(this.hiddenPathIds);
    const selected = this.selectedPathId;
    const previews = this.previewLineObjs.map((l) => ({
      pathId: l.userData.pathId, segmentId: l.userData.segmentId
    }));
    this.setJob(this.job, { frame: false });
    this.hiddenPathIds = hidden;
    this.selectedPathId = selected;
    // re-flash the running-line cursor on the rebuilt objects
    const restored = previews
      .map(({ pathId, segmentId }) => this.pathObjects.get(pathId)?.segments.get(segmentId))
      .filter(Boolean);
    for (const line of restored) {
      line.userData.__preview = true;
      line.material.color.set(0xffb454);
      line.material.transparent = false;
    }
    this.previewLineObjs = restored;
    this.applyVisibility();
  }

  clearJob() {
    this.toolpathGroup.clear();
    this.rapidGroup.clear();
    this.swathGroup.clear();
    this.pathObjects.clear();
    this.selectedPathId = null;
    this.swathCount = 0;
  }

  setRapids(rapidMoves) {
    this.rapidGroup.clear();
    const pts = [];
    for (const r of rapidMoves) {
      pts.push(new THREE.Vector3(r.start.x, r.start.y, r.start.z));
      pts.push(new THREE.Vector3(r.end.x, r.end.y, r.end.z));
    }
    if (!pts.length) return;
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: 0x39434f, transparent: true, opacity: 0.6 });
    this.rapidGroup.add(new THREE.LineSegments(geo, mat));
  }

  setToolPosition(pos) {
    if (!this.toolMarker) return;
    if (!pos) {
      this.toolMarker.visible = false; // port closed / no data yet
      return;
    }
    this.toolMarker.position.set(pos.x, pos.y, pos.z);
    this.toolMarker.visible = true;
  }

  // Probe mesh over the toolpath: triangle wireframe (derived) + vertices.
  // Unmeasured vertices sit just above Z0 in grey; measured ones use their Z
  // mapped through the selected height-map colormap.
  setProbe(vertices = [], triangles = []) {
    const drop = (obj) => {
      if (!obj) return;
      obj.parent?.remove(obj);
      obj.geometry.dispose();
      obj.material.dispose();
    };
    drop(this.probePlan);
    drop(this.probeHits);
    this.probePlan = null;
    this.probeHits = null;
    this.probeMesh = { vertices, triangles };
    this.#lastProbeArgs = { vertices, triangles };

    if (!vertices.length) { this.#refreshZLabels(); return; }

    const zs = vertices.map((v) => Number(v.z)).filter((n) => Number.isFinite(n));
    const zMin = zs.length ? Math.min(...zs) : 0;
    const zSpan = Math.max(1e-6, (zs.length ? Math.max(...zs) : 0) - zMin);

    // vertices
    const pos = new Float32Array(vertices.length * 3);
    const col = new Float32Array(vertices.length * 3);
    vertices.forEach((v, i) => {
      const measured = Number.isFinite(Number(v.z));
      pos[i * 3] = v.x;
      pos[i * 3 + 1] = v.y;
      pos[i * 3 + 2] = measured ? Number(v.z) : 0.05;
      if (measured) {
        const [r, g, b] = colormapRGB(this.probeColormap, (Number(v.z) - zMin) / zSpan);
        col[i * 3] = r;
        col[i * 3 + 1] = g;
        col[i * 3 + 2] = b;
      } else {
        col[i * 3] = 0.62;
        col[i * 3 + 1] = 0.66;
        col[i * 3 + 2] = 0.72;
      }
    });
    const vGeo = new THREE.BufferGeometry();
    vGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    vGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.probePlan = new THREE.Points(vGeo, new THREE.PointsMaterial({ size: 5, vertexColors: true, sizeAttenuation: false }));
    this.layerGroups.probePoints.add(this.probePlan);

    // triangle wireframe: 3 edges per triangle, z follows measured vertices
    if (triangles.length) {
      const xyz = new Float32Array(triangles.length * 3 * 2 * 3);
      const zOf = (v) => (Number.isFinite(Number(v?.z)) ? Number(v.z) + 0.004 : 0.04);
      let w = 0;
      for (const [a, b, c] of triangles) {
        const ring = [vertices[a], vertices[b], vertices[c], vertices[a]];
        for (let k = 0; k < 3; k++) {
          const p = ring[k];
          const q = ring[k + 1];
          xyz[w++] = p.x; xyz[w++] = p.y; xyz[w++] = zOf(p);
          xyz[w++] = q.x; xyz[w++] = q.y; xyz[w++] = zOf(q);
        }
      }
      const tGeo = new THREE.BufferGeometry();
      tGeo.setAttribute('position', new THREE.BufferAttribute(xyz, 3));
      this.probeHits = new THREE.LineSegments(tGeo, new THREE.LineBasicMaterial({ color: 0x3b4756, transparent: true, opacity: 0.75 }));
      this.layerGroups.probeMesh.add(this.probeHits);
    }

    this.#refreshZLabels();
  }

  /** Height-map colormap for probe vertices + surface (see probe/colormap.js). */
  setProbeColormap(name) {
    this.probeColormap = name;
    if (this.#lastProbeArgs) {
      const { vertices, triangles } = this.#lastProbeArgs;
      this.setProbe(vertices, triangles); // rebuild colors
    }
  }

  /** Show/hide numeric Z labels at measured vertices. */
  setZLabels(show) {
    this.showZLabels = !!show;
    this.#refreshZLabels();
  }

  // Z-value text labels at measured probe vertices, as canvas sprites. Only
  // regenerated when data or the toggle changes — sprites are expensive, so
  // they are never rebuilt during camera movement.
  #zLabelGroup = null;
  #lastProbeArgs = null;
  #refreshZLabels() {
    if (this.#zLabelGroup) {
      this.#zLabelGroup.parent?.remove(this.#zLabelGroup);
      this.#zLabelGroup.traverse((o) => {
        o.material?.map?.dispose();
        o.material?.dispose();
      });
      this.#zLabelGroup = null;
    }
    if (!this.showZLabels || !this.#lastProbeArgs) return;
    const { vertices } = this.#lastProbeArgs;
    const measured = vertices.filter((v) => Number.isFinite(Number(v.z)));
    if (!measured.length) return;
    const group = new THREE.Group();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    for (const v of measured) {
      const text = Number(v.z).toFixed(2);
      // measure with the shared canvas, then draw into a per-sprite canvas
      ctx.font = '600 24px ui-monospace, monospace';
      const w = Math.ceil(ctx.measureText(text).width) + 8;
      const h = 30;
      canvas.width = w;
      canvas.height = h;
      const c2 = document.createElement('canvas');
      c2.width = w;
      c2.height = h;
      const g = c2.getContext('2d');
      g.font = '600 24px ui-monospace, monospace';
      g.textBaseline = 'middle';
      g.textAlign = 'center';
      g.fillStyle = 'rgba(8, 10, 14, 0.72)';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#dbe4f0';
      g.fillText(text, w / 2, h / 2);
      const tex = new THREE.CanvasTexture(c2);
      tex.minFilter = THREE.LinearFilter;
      const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(w / 30, h / 30, 1); // ≈1mm tall text in world units
      sprite.position.set(v.x + 1.2, v.y + 1.2, Number(v.z) + 0.4);
      sprite.renderOrder = 10;
      group.add(sprite);
    }
    this.#zLabelGroup = group;
    this.layerGroups.zLabels.add(group);
  }

  // Point-placement cursor (autolevel edit modes). free: crosshair + ring at
  // the exact mouse position; centroid: dot snapped to the refine engine's
  // candidate + outline of the triangle under the mouse (red = no candidate).
  #placing = null; // { kind:'free'|'centroid', group, ring, cross?, dot?, tri? }

  startPlacing(kind = 'free') {
    this.stopPlacing();
    const group = new THREE.Group();
    const accent = kind === 'centroid' ? 0xf5a623 : 0x4f9cf9;

    // fixed 24-segment ring, radius 1.6mm, built once in local space — only
    // the group position changes per mousemove, so no per-frame allocations
    const ringPts = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      ringPts.push(new THREE.Vector3(1.6 * Math.cos(a), 1.6 * Math.sin(a), 0));
    }
    const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
    const ringMat = new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.9 });
    const ring = new THREE.LineLoop(ringGeo, ringMat);
    ring.frustumCulled = false;
    group.add(ring);
    const parts = { kind, group, ring };

    if (kind === 'free') {
      // crosshair strokes: 4 fixed segments around the local origin
      const s = 3; // arm length, mm
      const cs = new Float32Array([
        -s, 0, 0, -1.2, 0, 0,
        1.2, 0, 0, s, 0, 0,
        0, -s, 0, 0, -1.2, 0,
        0, 1.2, 0, 0, s, 0,
      ]);
      const cg = new THREE.BufferGeometry();
      cg.setAttribute('position', new THREE.BufferAttribute(cs, 3));
      const cross = new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.95 }));
      cross.frustumCulled = false;
      group.add(cross);
      parts.cross = cross;
    } else {
      // dot at the snapped candidate; triangle outline updates per move.
      // The outline lives in overlayGroup (NOT under the group): its geometry
      // is built in world coordinates, and the group is translated to the
      // candidate position each move — nesting it would double-translate.
      const dg = new THREE.BufferGeometry();
      dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
      const dot = new THREE.Points(dg, new THREE.PointsMaterial({ color: accent, size: 6, sizeAttenuation: false }));
      dot.frustumCulled = false;
      group.add(dot);
      parts.dot = dot;
      const triGeo = new THREE.BufferGeometry(); // position filled per-move
      const triMat = new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.9 });
      const tri = new THREE.LineLoop(triGeo, triMat);
      tri.frustumCulled = false;
      tri.visible = false;
      this.overlayGroup.add(tri);
      parts.tri = tri;
    }
    group.visible = false; // until the first mousemove
    this.overlayGroup.add(group);
    this.#placing = parts;
    this.renderer.domElement.style.cursor = 'crosshair';
  }

  /** Update the placement cursor from a mouse event (mouse-follow preview). */
  updatePlacing(e, candidate) {
    const p = this.#placing;
    if (!p) return;
    const w = this.#screenToWorld(e);
    if (!w) {
      p.group.visible = false;
      if (p.tri) p.tri.visible = false;
      return;
    }
    const zTop = 0.08; // sit above grid, triangles and surface tints
    p.group.visible = true;

    const outlineTriangle = (idx, color) => {
      const m = this.probeMesh;
      p.tri.material.color.setHex(color);
      if (!m || idx < 0) { p.tri.visible = false; return; }
      const [a, b, c] = m.triangles[idx];
      const ring = [m.vertices[a], m.vertices[b], m.vertices[c]];
      p.tri.geometry.setFromPoints(ring.map((v) => new THREE.Vector3(v.x, v.y, zTop - 0.02)));
      p.tri.visible = true;
    };

    if (p.kind === 'free') {
      p.group.position.set(w.x, w.y, zTop);
      return;
    }
    // centroid mode: valid candidate snaps to it; rejected/outside turns red
    const valid = candidate && !candidate.rejected && Number.isFinite(candidate.x);
    if (valid) {
      p.ring.material.color.setHex(0xf5a623);
      p.dot.material.color.setHex(0xf5a623);
      p.group.position.set(candidate.x, candidate.y, zTop);
      outlineTriangle(candidate.triangle, 0xf5a623);
    } else {
      p.ring.material.color.setHex(0xef4444);
      p.dot.material.color.setHex(0xef4444);
      p.group.position.set(w.x, w.y, zTop);
      outlineTriangle(this.locateTriangle(w.x, w.y), 0xef4444);
    }
  }

  stopPlacing() {
    const p = this.#placing;
    if (!p) return;
    this.overlayGroup.remove(p.group);
    p.group.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
    if (p.tri) {
      // outline is parented to overlayGroup, not the group (world coords)
      this.overlayGroup.remove(p.tri);
      p.tri.geometry.dispose();
      p.tri.material.dispose();
    }
    this.#placing = null;
    this.renderer.domElement.style.cursor = '';
  }

  /** Probe triangle under a screen point, for click-to-refine. -1 when none. */
  probeTriangleAt(e) {
    if (!this.probeMesh?.triangles?.length) return -1;
    const p = this.#screenToWorld(e);
    if (!p) return -1;
    return this.locateTriangle(p.x, p.y);
  }

  /** World XY on the PCB plane under a screen event, or null. */
  probeWorldAt(e) {
    return this.#screenToWorld(e);
  }

  /** Triangle containing (x, y). -1 when outside the mesh. */
  locateTriangle(x, y) {
    if (!this.probeMesh?.triangles?.length) return -1;
    const { vertices, triangles } = this.probeMesh;
    for (let i = 0; i < triangles.length; i++) {
      const [a, b, c] = triangles[i];
      const A = vertices[a];
      const B = vertices[b];
      const C = vertices[c];
      const d1 = (x - B.x) * (A.y - B.y) - (A.x - B.x) * (y - B.y);
      const d2 = (x - C.x) * (B.y - C.y) - (B.x - C.x) * (y - C.y);
      const d3 = (x - A.x) * (C.y - A.y) - (C.x - A.x) * (y - A.y);
      const neg = d1 < 0 || d2 < 0 || d3 < 0;
      const pos = d1 > 0 || d2 > 0 || d3 > 0;
      if (!(neg && pos)) return i;
    }
    return -1;
  }

  /** Filled surface mesh from measured triangles, tinted low→high. */
  setSurface(vertices = [], triangles = []) {
    const drop = (obj) => {
      if (!obj) return;
      obj.parent?.remove(obj);
      obj.geometry.dispose();
      obj.material.dispose();
    };
    drop(this.surfaceMesh);
    this.surfaceMesh = null;

    const usable = [];
    for (const t of triangles) {
      const tri = t.map((i) => vertices[i]);
      if (tri.every((v) => v && Number.isFinite(Number(v.z)))) usable.push(tri);
    }
    if (!usable.length) return;

    const zs = vertices.filter((v) => Number.isFinite(Number(v.z))).map((v) => Number(v.z));
    const zMin = Math.min(...zs);
    const zSpan = Math.max(1e-6, Math.max(...zs) - zMin);

    const pos = new Float32Array(usable.length * 9);
    const col = new Float32Array(usable.length * 9);
    let w = 0;
    for (const [A, B, C] of usable) {
      for (const v of [A, B, C]) {
        pos[w] = v.x; pos[w + 1] = v.y; pos[w + 2] = Number(v.z) + 0.002;
        const [r, g, b] = colormapRGB(this.probeColormap, (Number(v.z) - zMin) / zSpan);
        col[w] = r;
        col[w + 1] = g;
        col[w + 2] = b;
        w += 3;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.surfaceMesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })
    );
    this.layerGroups.surface.add(this.surfaceMesh);
  }

  /** Probe visiting order: a thin stroke (slightly wider than toolpath lines)
   *  plus one arrowhead per hop. WebGL linewidth is stuck at 1px, so the
   *  stroke is a narrow ribbon rather than a Line. */
  setProbeOrder(points = []) {
    const drop = (obj) => {
      if (!obj) return;
      obj.parent?.remove(obj);
      obj.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
    };
    drop(this.probeOrderLine);
    this.probeOrderLine = null;
    if (points.length < 2) return;

    const color = 0xff3d9a;
    const group = new THREE.Group();
    const stroke = this.#solidRibbon(points, color, 0.07, 0.08);
    if (stroke) group.add(stroke);
    const arrows = this.#travelArrows(points, color, 0.08, 0.7);
    if (arrows) group.add(arrows);
    if (!group.children.length) return;
    group.renderOrder = 5;
    this.probeOrderLine = group;
    this.layerGroups.travel.add(group);
  }

  /** Repeatability-test overlay: spot markers + the visit path (burst or cycled). */
  setRepeatTest(spots = [], path = []) {
    const drop = (obj) => {
      if (!obj) return;
      obj.parent?.remove(obj);
      obj.geometry?.dispose();
      obj.material?.dispose();
    };
    drop(this.repeatSpots);
    drop(this.repeatPath);
    this.repeatSpots = null;
    this.repeatPath = null;

    if (spots.length) {
      const pos = new Float32Array(spots.length * 3);
      spots.forEach((s, i) => {
        pos[i * 3] = s.x;
        pos[i * 3 + 1] = s.y;
        pos[i * 3 + 2] = 0.14;
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.repeatSpots = new THREE.Points(geo, new THREE.PointsMaterial({
        color: 0x22d3ee, size: 11, sizeAttenuation: false, depthTest: false
      }));
      this.repeatSpots.renderOrder = 7;
      this.layerGroups.repeatability.add(this.repeatSpots);
    }

    if (path.length >= 2) {
      const ribbon = this.#solidRibbon(path, 0x22d3ee, 0.1, 0.32);
      if (ribbon) {
        this.repeatPath = ribbon;
        this.layerGroups.repeatability.add(ribbon);
      }
    }
  }

  /** Flat ribbon along an XY polyline. Zero-length hops (repeat probes) are skipped. */
  #solidRibbon(points, color, z, halfW) {
    const positions = [];
    const indices = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-4) continue;
      const nx = (-dy / len) * halfW;
      const ny = (dx / len) * halfW;
      const base = positions.length / 3;
      positions.push(
        a.x + nx, a.y + ny, z,
        a.x - nx, a.y - ny, z,
        b.x + nx, b.y + ny, z,
        b.x - nx, b.y - ny, z
      );
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
    if (!positions.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide
    }));
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    return mesh;
  }

  /** One arrowhead per hop, sitting just before the destination point. */
  #travelArrows(points, color, z, size) {
    const positions = [];
    const indices = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.4) continue;
      const s = Math.min(size, len * 0.35);
      const ux = dx / len;
      const uy = dy / len;
      const nx = -uy;
      const ny = ux;
      // tip stops short of the probe point so the vertex stays readable
      const tipX = b.x - ux * Math.min(0.6, len * 0.25);
      const tipY = b.y - uy * Math.min(0.6, len * 0.25);
      const base = positions.length / 3;
      positions.push(
        tipX, tipY, z,
        tipX - ux * s + nx * s * 0.45, tipY - uy * s + ny * s * 0.45, z,
        tipX - ux * s - nx * s * 0.45, tipY - uy * s - ny * s * 0.45, z
      );
      indices.push(base, base + 1, base + 2);
    }
    if (!positions.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.95, depthTest: false, side: THREE.DoubleSide
    }));
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    return mesh;
  }

  /** ΔZ comparison overlay: dots at matched points, blue→red by |ΔZ| scale. */
  setHeightmapDiff(result) {
    const drop = (obj) => {
      if (!obj) return;
      obj.parent?.remove(obj);
      obj.geometry.dispose();
      obj.material.dispose();
    };
    drop(this.hmDiffDots);
    this.hmDiffDots = null;
    if (!result?.pairs?.length) return;

    const scale = Math.max(1e-6, Math.max(Math.abs(result.min), Math.abs(result.max)));
    const pos = new Float32Array(result.pairs.length * 3);
    const col = new Float32Array(result.pairs.length * 3);
    result.pairs.forEach((pair, i) => {
      pos[i * 3] = pair.a.x;
      pos[i * 3 + 1] = pair.a.y;
      pos[i * 3 + 2] = 0.1;
      // ΔZ negative → blue end, positive → red end, zero → mid
      const [r, g, b] = colormapRGB('blue-red', (pair.dz / scale + 1) / 2);
      col[i * 3] = r;
      col[i * 3 + 1] = g;
      col[i * 3 + 2] = b;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.hmDiffDots = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 7, vertexColors: true, sizeAttenuation: false, depthTest: false
    }));
    this.hmDiffDots.renderOrder = 6;
    this.layerGroups.comparison.add(this.hmDiffDots);
  }

  // --- view presets (brief §17: zoom/pan/orbit companions) ---
  setView(name) {
    const dirs = {
      top: new THREE.Vector3(0, 0, 1),       // PCB plan view: X right, Y up
      left: new THREE.Vector3(-1, 0, 0),     // from -X looking +X
      right: new THREE.Vector3(1, 0, 0),     // from +X looking -X
      iso: new THREE.Vector3(1, -1, 0.85)    // classic isometric corner
    };
    const dir = dirs[name];
    if (!dir) return;
    // Plan and side views are orthographic so edges stay parallel and
    // millimetres read true. ISO (and any later orbit) stays perspective.
    if (name === 'iso') this.#usePerspective();
    else this.#useOrthographic();
    const target = this.orbit.target.clone();
    const r = Math.max(this.camera.position.distanceTo(target), 5);
    dir.normalize();
    this.#viewAnim = {
      from: this.camera.position.clone(),
      to: target.clone().addScaledVector(dir, r),
      fromTarget: target.clone(),
      toTarget: target.clone(),
      t0: performance.now(),
      dur: 350
    };
  }

  #viewAnim = null;
  #stepViewAnim() {
    const a = this.#viewAnim;
    if (!a) return;
    const k = Math.min(1, (performance.now() - a.t0) / a.dur);
    const e = k * k * (3 - 2 * k); // smoothstep ease
    this.camera.position.lerpVectors(a.from, a.to, e);
    this.orbit.target.lerpVectors(a.fromTarget, a.toTarget, e);
    this.camera.lookAt(this.orbit.target);
    if (k >= 1) this.#viewAnim = null;
  }

  highlightPath(pathId) {
    this.selectedPathId = pathId;
    this.applyVisibility();
  }

  // --- visibility controls (brief §21) ---
  hidePath(pathId) {
    if (pathId == null) return;
    this.hiddenPathIds.add(pathId);
    this.applyVisibility();
  }

  hideAll() {
    for (const pid of this.pathObjects.keys()) this.hiddenPathIds.add(pid);
    this.applyVisibility();
  }

  isolatePath(pathId) {
    for (const pid of this.pathObjects.keys()) {
      if (pid !== pathId) this.hiddenPathIds.add(pid);
    }
    this.hiddenPathIds.delete(pathId);
    this.applyVisibility();
  }

  hideOthers(pathId) {
    this.isolatePath(pathId); // visually equivalent
  }

  showAll() {
    this.hiddenPathIds.clear();
    this.applyVisibility();
  }

  get hiddenCount() {
    return this.hiddenPathIds.size;
  }

  applyVisibility() {
    const selected = this.selectedPathId;
    for (const [pid, entry] of this.pathObjects) {
      const hidden = this.hiddenPathIds.has(pid);
      const isSelected = pid === selected;
      entry.segments.forEach((line) => {
        line.visible = !hidden;
        if (line.userData.__preview) return; // preview flash wins over selection tint
        // selected: white-hot; a selection exists: others dimmed; no selection: full color
        if (isSelected) {
          line.material.color.set(0xffffff);
          line.material.opacity = 1;
          line.material.transparent = false;
        } else {
          line.material.color.copy(entry.color);
          line.material.opacity = selected != null ? 0.25 : 1;
          line.material.transparent = selected != null;
        }
      });
      for (const mesh of entry.swathMeshes || []) {
        if (!mesh?.material) continue;
        mesh.visible = !hidden;
        mesh.material.opacity = selected != null && !isSelected ? 0.12 : 0.4;
      }
    }
  }

  // --- region selection (brief §19.3) ---
  // Selects all paths with any segment intersecting the given world-space
  // rectangle (two corner points on the z=0 plane, XY).
  selectRegion(cornerA, cornerB) {
    if (!this.toolpathGroup.visible) return [];
    const minX = Math.min(cornerA.x, cornerB.x);
    const maxX = Math.max(cornerA.x, cornerB.x);
    const minY = Math.min(cornerA.y, cornerB.y);
    const maxY = Math.max(cornerA.y, cornerB.y);

    const hits = new Set();
    for (const [pid, entry] of this.pathObjects) {
      if (this.hiddenPathIds.has(pid)) continue;
      for (const line of entry.segments.values()) {
        const pos = line.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          const y = pos.getY(i);
          if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
            hits.add(pid);
            break;
          }
        }
      }
    }
    return [...hits];
  }

  frameJob(job) {
    const { min, max } = job.bounds;
    const cx = (min.x + max.x) / 2, cy = (min.y + max.y) / 2, cz = (min.z + max.z) / 2;
    const radius = Math.max(5, Math.hypot(max.x - min.x, max.y - min.y, max.z - min.z) / 2);
    // Finish framing at the requested view direction. An in-flight preset
    // animation otherwise restores its old target after the new job is loaded.
    const direction = this.#viewAnim
      ? this.#viewAnim.to.clone().sub(this.#viewAnim.toTarget)
      : this.camera.position.clone().sub(this.orbit.target);
    this.#viewAnim = null;
    if (direction.lengthSq() < 1e-8) direction.set(1, -1, 0.85);
    direction.normalize();
    const aspect = this.persp.aspect || 1;
    const halfHeight = radius * 1.15 / Math.min(aspect, 1);
    const distance = halfHeight / Math.sin(THREE.MathUtils.degToRad(this.persp.fov) / 2);
    this.orbit.target.set(cx, cy, cz);
    this.camera.position.copy(this.orbit.target).addScaledVector(direction, distance);
    if (this.camera.isOrthographicCamera) {
      this.camera.top = halfHeight;
      this.camera.bottom = -halfHeight;
      this.camera.left = -halfHeight * aspect;
      this.camera.right = halfHeight * aspect;
    }
    this.camera.zoom = 1;
    this.camera.far = Math.max(5000, distance + radius * 2);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.orbit.target);

  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    const aspect = w / h;
    this.persp.aspect = aspect;
    this.persp.updateProjectionMatrix();
    const halfH = (this.ortho.top - this.ortho.bottom) / 2;
    if (halfH > 0) {
      this.ortho.left = -halfH * aspect;
      this.ortho.right = halfH * aspect;
      this.ortho.updateProjectionMatrix();
    }
    this.renderer.setSize(w, h);
  }

  /** Match an orthographic frustum to the current perspective view, then use it. */
  #useOrthographic() {
    if (this.camera.isOrthographicCamera) return;
    const dist = Math.max(this.persp.position.distanceTo(this.orbit.target), 1);
    const halfH = Math.tan(THREE.MathUtils.degToRad(this.persp.fov) / 2) * dist;
    const aspect = this.persp.aspect || 1;
    this.ortho.top = halfH;
    this.ortho.bottom = -halfH;
    this.ortho.left = -halfH * aspect;
    this.ortho.right = halfH * aspect;
    this.ortho.zoom = 1;
    this.ortho.position.copy(this.persp.position);
    this.ortho.up.copy(this.persp.up);
    this.ortho.lookAt(this.orbit.target);
    this.ortho.updateProjectionMatrix();
    this.camera = this.ortho;
  }

  /** Restore perspective, keeping the orthographic framing (zoom included). */
  #usePerspective() {
    if (this.camera.isPerspectiveCamera) return;
    const halfH = (this.ortho.top - this.ortho.bottom) / 2 / Math.max(this.ortho.zoom, 1e-6);
    const dist = halfH / Math.tan(THREE.MathUtils.degToRad(this.persp.fov) / 2);
    const dir = this.ortho.position.clone().sub(this.orbit.target);
    if (dir.lengthSq() < 1e-8) dir.set(0, 0, 1);
    dir.setLength(Math.max(dist, 1));
    this.persp.position.copy(this.orbit.target).add(dir);
    this.persp.up.copy(this.ortho.up);
    this.persp.lookAt(this.orbit.target);
    this.persp.updateProjectionMatrix();
    this.camera = this.persp;
  }

  dispose() {
    this.stopPlacing();
    this.setProbeOrder(); // drop the travel-line
    this.setRepeatTest();
    this.showZLabels = false;
    this.#refreshZLabels(); // dispose label sprites
    this.#unbindEvents();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // --- internals ---

  #buildOverlay() {
    // work origin axes: X red, Y green, Z blue
    const axes = new THREE.Group();
    const mk = (dir, color) => {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        dir
      ]);
      return new THREE.Line(geo, new THREE.LineBasicMaterial({ color }));
    };
    axes.add(mk(new THREE.Vector3(10, 0, 0), 0xff5555));
    axes.add(mk(new THREE.Vector3(0, 10, 0), 0x55ff88));
    axes.add(mk(new THREE.Vector3(0, 0, 10), 0x5588ff));
    this.layerGroups.axes.add(axes);
    this.axesGroup = axes;

    // grid in XY plane at z=0 (PCB plane), 10mm cells
    const grid = new THREE.GridHelper(200, 20, 0x2a3342, 0x1c2430);
    grid.rotation.x = Math.PI / 2; // GridHelper is XZ by default
    this.layerGroups.grid.add(grid);

    // rulers (built per-job in #buildRulers; default workspace until then)
    this.rulerGroup = new THREE.Group();
    this.layerGroups.rulers.add(this.rulerGroup);
    this.#buildRulers({ min: { x: -100, y: -100 }, max: { x: 100, y: 100 } });

    // tool position marker: small crosshair + vertical line
    this.toolMarker = new THREE.Group();
    const mkT = (a, b, c) => {
      const g = new THREE.BufferGeometry().setFromPoints([a, b]);
      return new THREE.Line(g, new THREE.LineBasicMaterial({ color: c }));
    };
    const t = 0.8;
    this.toolMarker.add(mkT(new THREE.Vector3(-t, 0, 0), new THREE.Vector3(t, 0, 0), 0xffffff));
    this.toolMarker.add(mkT(new THREE.Vector3(0, -t, 0), new THREE.Vector3(0, t, 0), 0xffffff));
    this.toolMarker.add(mkT(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 6), 0x888888));
    this.toolMarker.visible = false;
    this.layerGroups.tool.add(this.toolMarker);

    // preview cursor marker (step-through): amber dot + drop line, distinct from live tool
    this.previewMarker = new THREE.Group();
    const mkP = (a, b, c, opacity = 1) => {
      const g = new THREE.BufferGeometry().setFromPoints([a, b]);
      return new THREE.Line(
        g,
        new THREE.LineBasicMaterial({ color: c, transparent: true, opacity })
      );
    };
    const p = 0.7;
    this.previewMarker.add(mkP(new THREE.Vector3(-p, 0, 0), new THREE.Vector3(p, 0, 0), 0xffb454));
    this.previewMarker.add(mkP(new THREE.Vector3(0, -p, 0), new THREE.Vector3(0, p, 0), 0xffb454));
    this.previewMarker.add(mkP(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 5), 0xffb454, 0.4));
    this.previewMarker.visible = false;
    this.layerGroups.preview.add(this.previewMarker);
    this.previewLineObjs = [];

    this.probePlan = null;
    this.probeHits = null;
    this.probeMesh = { vertices: [], triangles: [] };
    this.surfaceMesh = null;
  }

  // --- step-through preview cursor ---
  // entries: [{pathId, segmentId}] for the current source line, or null to clear.
  // Flashes those segments amber and moves the preview marker to the line's end point.
  setPreviewCursor(entries, endPos) {
    // restore previously flashed segments to normal appearance
    this.previewLineObjs.forEach((l) => l.userData.__preview = false);
    this.previewLineObjs = [];
    this.applyVisibility();

    if (!entries?.length) {
      this.previewMarker.visible = false;
      return null;
    }

    for (const { pathId, segmentId } of entries) {
      const line = this.pathObjects.get(pathId)?.segments.get(segmentId);
      if (line) {
        line.userData.__preview = true;
        line.material.color.set(0xffb454);
        line.material.opacity = 1;
        line.material.transparent = false;
        this.previewLineObjs.push(line);
      }
    }
    if (endPos) {
      this.previewMarker.position.set(endPos.x, endPos.y, endPos.z);
      this.previewMarker.visible = true;
    }
    return entries[0];
  }

  // --- rulers (brief §17: coordinate grid) ---
  #niceStep(range, targetTicks = 10) {
    const raw = range / targetTicks;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const candidates = [1, 2, 5, 10].map((m) => m * pow);
    return candidates.find((c) => c >= raw) || 10 * pow;
  }

  #makeLabel(text) {
    // canvas sprite: crisp text labels for ruler ticks
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const font = '24px "SF Mono", Consolas, monospace';
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width) + 8;
    canvas.width = w;
    canvas.height = 32;
    ctx.font = font;
    ctx.fillStyle = '#7a8699';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 4, 16);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    sprite.scale.set((w / 32) * 1.6, 1.6, 1);
    return sprite;
  }

  #buildRulers(bounds) {
    // clear previous rulers
    this.rulerGroup.traverse((o) => {
      if (o.material?.map) o.material.map.dispose();
      if (o.geometry) o.geometry.dispose();
    });
    this.rulerGroup.clear();

    const pad = Math.max((bounds.max.x - bounds.min.x), (bounds.max.y - bounds.min.y), 5) * 0.08;
    const minX = Math.min(0, bounds.min.x) - pad;
    const maxX = Math.max(0, bounds.max.x) + pad;
    const minY = Math.min(0, bounds.min.y) - pad;
    const maxY = Math.max(0, bounds.max.y) + pad;

    const step = this.#niceStep(Math.max(maxX - minX, maxY - minY));

    const tickLen = Math.max(step * 0.22, 0.5);
    const tickMat = new THREE.LineBasicMaterial({ color: 0x7a8699, transparent: true, opacity: 0.7 });
    const pts = [];
    const labels = [];

    const fmt = (v) => (step < 1 ? v.toFixed(1).replace(/\.0$/, '') : String(Math.round(v)));

    for (let x = Math.ceil(minX / step) * step; x <= maxX; x += step) {
      const xr = Math.round(x / step) * step; // dodge float drift
      pts.push(xr, minY, 0, xr, minY - tickLen, 0);
      if (Math.abs(xr) > 1e-9) {
        const s = this.#makeLabel(fmt(xr));
        s.position.set(xr, minY - tickLen * 2.2, 0);
        labels.push(s);
      }
    }
    for (let y = Math.ceil(minY / step) * step; y <= maxY; y += step) {
      const yr = Math.round(y / step) * step;
      pts.push(minX, yr, 0, minX - tickLen, yr, 0);
      if (Math.abs(yr) > 1e-9) {
        const s = this.#makeLabel(fmt(yr));
        s.position.set(minX - tickLen * 2.4, yr, 0);
        labels.push(s);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.rulerGroup.add(new THREE.LineSegments(geo, tickMat));
    labels.forEach((l) => this.rulerGroup.add(l));
  }

  #setupOrbit() {
    // simple orbit/pan/zoom — no external controls dependency
    const dom = this.renderer.domElement;
    this.#orbitUnbind = null;
    this.orbit = {
      target: new THREE.Vector3(0, 0, 0),
      spherical: null,
      panning: false
    };

    const onDown = (e) => {
      if (e.button === 0 && e.shiftKey) {
        // Shift+LMB: start rubber-band region selection
        this.#regionStart = this.#screenToWorld(e);
        this.#regionRect = null;
        return;
      }
      if (e.button === 0 && (e.ctrlKey || e.metaKey)) {
        // Ctrl/Cmd+LMB: pan (trackpad/single-button friendly)
        this.orbit.panning = true;
        this.orbit.last = { x: e.clientX, y: e.clientY };
        return;
      }
      if (e.button === 0) this.#maybeSelect(e);
      this.orbit.panning = e.button === 2 || e.button === 1;
      this.orbit.last = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e) => {
      if (this.#regionStart) {
        this.#drawRegionRect(e);
        return;
      }
      if (!this.orbit.last) return;
      const dx = e.clientX - this.orbit.last.x;
      const dy = e.clientY - this.orbit.last.y;
      this.orbit.last = { x: e.clientX, y: e.clientY };
      if (this.orbit.panning) {
        // pan: translate camera AND target together (screen-space drag → world)
        let scale;
        if (this.camera.isOrthographicCamera) {
          const rect = this.renderer.domElement.getBoundingClientRect();
          const visibleH = (this.camera.top - this.camera.bottom) / this.camera.zoom;
          scale = visibleH / Math.max(rect.height, 1);
        } else {
          scale = this.camera.position.distanceTo(this.orbit.target) * 0.0015;
        }
        const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
        const delta = new THREE.Vector3()
          .addScaledVector(right, -dx * scale)
          .addScaledVector(up, dy * scale);
        this.camera.position.add(delta);
        this.orbit.target.add(delta);
      } else {
        // leaving a flat view: orbit is a perspective move
        if (this.camera.isOrthographicCamera) this.#usePerspective();
        const offset = this.camera.position.clone().sub(this.orbit.target);
        const sph = new THREE.Spherical().setFromVector3(offset);
        sph.theta -= dx * 0.006;
        sph.phi = Math.min(Math.PI - 0.05, Math.max(0.05, sph.phi - dy * 0.006));
        this.camera.position.copy(this.orbit.target).add(new THREE.Vector3().setFromSpherical(sph));
      }
      this.camera.lookAt(this.orbit.target);
    };
    const onUp = (e) => {
      if (this.#regionStart) {
        this.#finishRegionSelect(e);
        return;
      }
      this.orbit.panning = false;
      this.orbit.last = null;
    };
    const onWheel = (e) => {
      e.preventDefault();
      if (this.camera.isOrthographicCamera) {
        this.camera.zoom *= e.deltaY > 0 ? 1 / 1.12 : 1.12;
        this.camera.zoom = Math.min(80, Math.max(0.05, this.camera.zoom));
        this.camera.updateProjectionMatrix();
        return;
      }
      const offset = this.camera.position.clone().sub(this.orbit.target);
      offset.multiplyScalar(e.deltaY > 0 ? 1.12 : 1 / 1.12);
      this.camera.position.copy(this.orbit.target).add(offset);
    };
    const onCtx = (e) => e.preventDefault();

    dom.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    dom.addEventListener('wheel', onWheel, { passive: false });
    dom.addEventListener('contextmenu', onCtx);

    this.#orbitUnbind = () => {
      dom.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      dom.removeEventListener('wheel', onWheel);
      dom.removeEventListener('contextmenu', onCtx);
    };
  }

  #maybeSelect(e) {
    if (!this.pathObjects.size || !this.onSelect || !this.toolpathGroup.visible) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.toolpathGroup.children.filter((line) => line.visible), false);
    if (!hits.length) {
      this.onSelect(null);
      return;
    }
    const { pathId, segmentId, sourceLine } = hits[0].object.userData;
    this.onSelect({ pathId, segmentId, sourceLine });
  }

  // --- region selection internals ---

  #screenToWorld(e) {
    // project the mouse ray onto the z=0 plane (PCB plane)
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); // z = 0
    const point = new THREE.Vector3();
    const hit = this.raycaster.ray.intersectPlane(plane, point);
    return hit ? { x: point.x, y: point.y } : null;
  }

  #drawRegionRect(e) {
    const now = this.#screenToWorld(e);
    if (!now) return;

    if (!this.#regionRect) {
      // rectangle outline: 4 corners as a LineLoop in screen-anchored world coords
      const geo = new THREE.BufferGeometry();
      const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
      this.#regionRect = new THREE.LineLoop(geo, mat);
      this.scene.add(this.#regionRect);
    }
    const a = this.#regionStart, b = now;
    const pts = [
      new THREE.Vector3(a.x, a.y, 0.5),
      new THREE.Vector3(b.x, a.y, 0.5),
      new THREE.Vector3(b.x, b.y, 0.5),
      new THREE.Vector3(a.x, b.y, 0.5)
    ];
    this.#regionRect.geometry.dispose();
    this.#regionRect.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  }

  #finishRegionSelect(e) {
    const end = this.#screenToWorld(e);
    if (this.#regionRect) {
      this.scene.remove(this.#regionRect);
      this.#regionRect.geometry.dispose();
      this.#regionRect = null;
    }
    if (this.#regionStart && end) {
      const pathIds = this.selectRegion(this.#regionStart, end);
      this.onSelect?.({ region: true, pathIds });
    }
    this.#regionStart = null;
  }

  previewLineObjs = [];
  #orbitUnbind = null;
  #onResize = null;
  #resizeObserver = null;
  #regionStart = null;
  #regionRect = null;
  #bindEvents() {
    this.#onResize = () => this.resize();
    window.addEventListener('resize', this.#onResize);
    // container-driven resizes: widget height grip, sidebar width gutters, dock
    // layout changes — none of these fire window:resize, but all change the
    // canvas box; observe the container so the renderer stays crisp 1:1
    this.#resizeObserver = new ResizeObserver(() => this.resize());
    this.#resizeObserver.observe(this.container);
  }
  #unbindEvents() {
    this.#orbitUnbind?.();
    this.#orbitUnbind = null;
    if (this.#onResize) window.removeEventListener('resize', this.#onResize);
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
  }

  #animate = () => {
    this.renderer.setAnimationLoop(() => {
      this.#stepViewAnim();
      this.renderer.render(this.scene, this.camera);
    });
  };
}
