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

  highlightPath(pathId) {
    this.selectedPathId = pathId;
    for (const [pid, entry] of this.pathObjects) {
      const selected = pid === pathId;
      entry.segments.forEach((line) => {
        // selected: white-hot; others: dimmed original color
        const c = selected ? new THREE.Color(0xffffff) : entry.color;
        line.material.color.copy(c);
        line.material.opacity = selected ? 1 : pathId != null ? 0.25 : 1;
        line.material.transparent = pathId != null && !selected;
      });
    }
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

    // grid in XY plane at z=0 (PCB plane), 10mm cells
    const grid = new THREE.GridHelper(200, 20, 0x2a3342, 0x1c2430);
    grid.rotation.x = Math.PI / 2; // GridHelper is XZ by default
    this.overlayGroup.add(grid);

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

  #setupOrbit() {
    // minimal orbit/pan/zoom — no external controls dependency
    const dom = this.renderer.domElement;
    this.orbit = {
      target: new THREE.Vector3(0, 0, 0),
      spherical: null,
      panning: false
    };

    const onDown = (e) => {
      if (e.button === 0) this.#maybeSelect(e);
      this.orbit.panning = e.button === 2 || e.button === 1;
      this.orbit.last = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e) => {
      if (!this.orbit.last) return;
      const dx = e.clientX - this.orbit.last.x;
      const dy = e.clientY - this.orbit.last.y;
      this.orbit.last = { x: e.clientX, y: e.clientY };
      if (this.orbit.panning) {
        const dist = this.camera.position.distanceTo(this.orbit.target);
        const scale = dist * 0.0015;
        const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
        this.orbit.target.addScaledVector(right, -dx * scale);
        this.orbit.target.addScaledVector(up, dy * scale);
      } else {
        const offset = this.camera.position.clone().sub(this.orbit.target);
        const sph = new THREE.Spherical().setFromVector3(offset);
        sph.theta -= dx * 0.006;
        sph.phi = Math.min(Math.PI - 0.05, Math.max(0.05, sph.phi - dy * 0.006));
        this.camera.position.copy(this.orbit.target).add(new THREE.Vector3().setFromSpherical(sph));
      }
      this.camera.lookAt(this.orbit.target);
    };
    const onUp = () => { this.orbit.panning = false; this.orbit.last = null; };
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

    this.#unbindEvents = () => {
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

  #onResize = null;
  #bindEvents() {
    this.#onResize = () => this.resize();
    window.addEventListener('resize', this.#onResize);
  }
  #unbindEvents() {
    if (this.#onResize) window.removeEventListener('resize', this.#onResize);
  }

  #animate = () => {
    this.renderer.setAnimationLoop(() => this.renderer.render(this.scene, this.camera));
  };
}
