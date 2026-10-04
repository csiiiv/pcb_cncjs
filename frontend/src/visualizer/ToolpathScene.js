// Three.js toolpath visualizer (brief §17–21).
// Renders parsed job geometry as selectable BufferGeometry lines:
//   - cutting paths: colored, raycastable, metadata-linked (operation/path/segment)
//   - rapids: dim dashed overlay, non-selectable
//   - grid + work origin axes
//   - tool position marker (live, from machine state)
import * as THREE from 'three';

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

export class ToolpathScene {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0e1116);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    // simple orbit controls (no external deps): LMB orbit, RMB pan, wheel zoom
    this.#setupOrbit();

    this.toolpathGroup = new THREE.Group();
    this.rapidGroup = new THREE.Group();
    this.overlayGroup = new THREE.Group(); // grid, axes, tool marker
    this.scene.add(this.toolpathGroup, this.rapidGroup, this.overlayGroup);

    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Line = { threshold: 0.3 };

    this.selectedPathId = null;
    this.hiddenPathIds = new Set();
    this.pathObjects = new Map(); // pathId -> { line, segments: Map(segId -> line) }
    this.onSelect = null; // (selection | null) => void
    this.onHover = null;

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

  setJob(job) {
    this.clearJob();
    if (!job) return;
    this.hiddenPathIds.clear();
    this.#buildRulers(job.bounds);

    for (const path of job.paths) {
      const color = PATH_COLORS[(path.id - 1) % PATH_COLORS.length];
      const segments = new Map();

      // one line object per segment: per-segment highlight without re-chunking
      for (const seg of path.segments) {
        const geo = new THREE.BufferGeometry().setFromPoints(segToPoints(seg));
        const mat = new THREE.LineBasicMaterial({ color });
        const line = new THREE.Line(geo, mat);
        line.userData = {
          type: 'toolpath-segment',
          pathId: path.id,
          segmentId: seg.id,
          sourceLine: seg.sourceLine,
          motion: seg.motion
        };
        this.toolpathGroup.add(line);
        segments.set(seg.id, line);
      }
      this.pathObjects.set(path.id, { color: new THREE.Color(color), segments });
    }
    this.frameJob(job);
  }

  clearJob() {
    this.toolpathGroup.clear();
    this.rapidGroup.clear();
    this.pathObjects.clear();
    this.selectedPathId = null;
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
  // and a low-to-high color so the surface range reads at a glance.
  setProbe(vertices = [], triangles = []) {
    const drop = (obj) => {
      if (!obj) return;
      this.overlayGroup.remove(obj);
      obj.geometry.dispose();
      obj.material.dispose();
    };
    drop(this.probePlan);
    drop(this.probeHits);
    this.probePlan = null;
    this.probeHits = null;
    this.probeMesh = { vertices, triangles };

    if (!vertices.length) return;

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
        const t = (Number(v.z) - zMin) / zSpan;
        col[i * 3] = 0.25 + 0.7 * t;
        col[i * 3 + 1] = 0.8 - 0.45 * t;
        col[i * 3 + 2] = 0.95 - 0.75 * t;
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
    this.overlayGroup.add(this.probePlan);

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
      this.overlayGroup.add(this.probeHits);
    }
  }

  /** Probe triangle under a screen point, for click-to-refine. -1 when none. */
  probeTriangleAt(e) {
    if (!this.probeMesh?.triangles?.length) return -1;
    const p = this.#screenToWorld(e);
    if (!p) return -1;
    const { vertices, triangles } = this.probeMesh;
    for (let i = 0; i < triangles.length; i++) {
      const [a, b, c] = triangles[i];
      const A = vertices[a];
      const B = vertices[b];
      const C = vertices[c];
      const d1 = (p.x - B.x) * (A.y - B.y) - (A.x - B.x) * (p.y - B.y);
      const d2 = (p.x - C.x) * (B.y - C.y) - (B.x - C.x) * (p.y - C.y);
      const d3 = (p.x - A.x) * (C.y - A.y) - (C.x - A.x) * (p.y - A.y);
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
      this.overlayGroup.remove(obj);
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
        const t = (Number(v.z) - zMin) / zSpan;
        col[w] = 0.16 + 0.5 * t;
        col[w + 1] = 0.55 + 0.2 * t;
        col[w + 2] = 0.85 - 0.45 * t;
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
    this.overlayGroup.add(this.surfaceMesh);
  }

  // --- view presets (brief §17: zoom/pan/orbit companions) ---
  setView(name) {
    const target = this.orbit.target.clone();
    const r = Math.max(this.camera.position.distanceTo(target), 5);
    const dirs = {
      top: new THREE.Vector3(0, 0, 1),       // PCB plan view: X right, Y up
      left: new THREE.Vector3(-1, 0, 0),     // from -X looking +X
      right: new THREE.Vector3(1, 0, 0),     // from +X looking -X
      iso: new THREE.Vector3(1, -1, 0.85)    // classic isometric corner
    };
    const dir = dirs[name];
    if (!dir) return;
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
    this.#applyVisibility();
  }

  // --- visibility controls (brief §21) ---
  hidePath(pathId) {
    if (pathId == null) return;
    this.hiddenPathIds.add(pathId);
    this.#applyVisibility();
  }

  hideAll() {
    for (const pid of this.pathObjects.keys()) this.hiddenPathIds.add(pid);
    this.#applyVisibility();
  }

  isolatePath(pathId) {
    for (const pid of this.pathObjects.keys()) {
      if (pid !== pathId) this.hiddenPathIds.add(pid);
    }
    this.hiddenPathIds.delete(pathId);
    this.#applyVisibility();
  }

  hideOthers(pathId) {
    this.isolatePath(pathId); // visually equivalent
  }

  showAll() {
    this.hiddenPathIds.clear();
    this.#applyVisibility();
  }

  get hiddenCount() {
    return this.hiddenPathIds.size;
  }

  #applyVisibility() {
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
    }
  }

  // --- region selection (brief §19.3) ---
  // Selects all paths with any segment intersecting the given world-space
  // rectangle (two corner points on the z=0 plane, XY).
  selectRegion(cornerA, cornerB) {
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
    this.camera.position.set(cx + radius * 1.4, cy - radius * 1.4, cz + radius * 1.1);
    this.camera.lookAt(cx, cy, cz);
    this.orbit.target.set(cx, cy, cz);
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  dispose() {
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
    this.overlayGroup.add(axes);
    this.axesGroup = axes;

    // grid in XY plane at z=0 (PCB plane), 10mm cells
    const grid = new THREE.GridHelper(200, 20, 0x2a3342, 0x1c2430);
    grid.rotation.x = Math.PI / 2; // GridHelper is XZ by default
    this.overlayGroup.add(grid);

    // rulers (built per-job in #buildRulers; default workspace until then)
    this.rulerGroup = new THREE.Group();
    this.overlayGroup.add(this.rulerGroup);
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
    this.overlayGroup.add(this.toolMarker);

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
    this.overlayGroup.add(this.previewMarker);
    this.#previewLineObjs = [];

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
    this.#previewLineObjs.forEach((l) => l.userData.__preview = false);
    this.#previewLineObjs = [];
    this.#applyVisibility();

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
        this.#previewLineObjs.push(line);
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
        const dist = this.camera.position.distanceTo(this.orbit.target);
        const scale = dist * 0.0015;
        const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
        const delta = new THREE.Vector3()
          .addScaledVector(right, -dx * scale)
          .addScaledVector(up, dy * scale);
        this.camera.position.add(delta);
        this.orbit.target.add(delta);
      } else {
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
    if (!this.pathObjects.size || !this.onSelect) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.toolpathGroup.children, false);
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

  #previewLineObjs = [];
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
