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
    this.toolMarker.position.set(pos.x, pos.y, pos.z);
    this.toolMarker.visible = true;
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

    // rulers (built per-job in #buildRulers)
    this.rulerGroup = new THREE.Group();
    this.overlayGroup.add(this.rulerGroup);

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

  #orbitUnbind = null;
  #onResize = null;
  #regionStart = null;
  #regionRect = null;
  #bindEvents() {
    this.#onResize = () => this.resize();
    window.addEventListener('resize', this.#onResize);
  }
  #unbindEvents() {
    this.#orbitUnbind?.();
    this.#orbitUnbind = null;
    if (this.#onResize) window.removeEventListener('resize', this.#onResize);
  }

  #animate = () => {
    this.renderer.setAnimationLoop(() => {
      this.#stepViewAnim();
      this.renderer.render(this.scene, this.camera);
    });
  };
}
