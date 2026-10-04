// Autolevel: authoritative probe mesh (vertices + Delaunay triangles).
// Dock slot = summary; Setup opens the modal mesh editor.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStoreSelector, probeStore, probeCommands, useProbe } from '../cnc/runtime.js';
import { useViz } from '../visualizer/vizStore.js';
import { triangularLattice } from '../probe/lattice.js';
import { refineCandidates } from '../probe/refine.js';
import { makeVertexId } from '../probe/mesh.js';
import { buildSurface } from '../probe/surface.js';
import { compensateGcode } from '../probe/compensate.js';
import { parseGcode } from '../jobs/parseGcode.js';
import { fmtAxis } from '../cnc/state.js';
import NumField from '../ui/NumField.jsx';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export default function AutolevelWidget() {
  const port = useStoreSelector((s) => s.connectedPort);
  const probe = useProbe(probeStore);
  const v = useViz();
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState(null);

  const [clearanceZ, setClearanceZ] = useState(3);
  const [startZ, setStartZ] = useState(1);
  const [endZ, setEndZ] = useState(-2);
  const [feedrate, setFeedrate] = useState(50);
  const [minX, setMinX] = useState(0);
  const [maxX, setMaxX] = useState(50);
  const [minY, setMinY] = useState(0);
  const [maxY, setMaxY] = useState(50);
  const [spacing, setSpacing] = useState(10);
  const [margin, setMargin] = useState(2);

  // normalize so partially-typed / inverted bounds can't poison refine + lattice
  const bounds = {
    minX: Math.min(minX, maxX),
    maxX: Math.max(minX, maxX),
    minY: Math.min(minY, maxY),
    maxY: Math.max(minY, maxY),
  };
  const measured = probe.vertices.filter((p) => Number.isFinite(Number(p.z))).length;
  const pending = probe.vertices.length - measured;

  // regenerate the lattice whenever bounds or spacing change; keeps any
  // measured vertices whose position still exists in the new lattice
  const regenerate = useCallback(() => {
    const keep = new Map(probe.vertices
      .filter((p) => Number.isFinite(Number(p.z)))
      .map((p) => [`${Math.round(p.x * 100)}:${Math.round(p.y * 100)}`, p]));
    const lattice = triangularLattice(bounds, spacing).map((p) => {
      const old = keep.get(`${Math.round(p.x * 100)}:${Math.round(p.y * 100)}`);
      return old ? { ...old } : { id: makeVertexId(), x: p.x, y: p.y };
    });
    // measured vertices outside the new bounds are dropped with the shrink
    probeStore.setMesh(lattice, bounds);
  }, [minX, maxX, minY, maxY, spacing, probe.vertices]);

  const regenerateRef = useRef(regenerate);
  regenerateRef.current = regenerate;

  useEffect(() => {
    if (open) return; // modal edits drive explicit regenerates
    regenerateRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minX, maxX, minY, maxY, spacing, open]);

  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Alt+click a probe triangle in the 3D view to refine it
  useEffect(() => {
    const dom = document.querySelector('.viz-container canvas');
    if (!dom || !open) return undefined;
    const onClick = (e) => {
      if (!e.altKey) return;
      const scene = v.scene;
      const idx = scene?.probeTriangleAt?.(e);
      if (idx == null || idx < 0) return;
      const candidates = refineCandidates({
        indices: scene.probeMesh.triangles[idx],
        vertices: scene.probeMesh.vertices,
        bounds,
      });
      if (candidates.length) {
        probeStore.addVertices(candidates.map((p) => ({ id: makeVertexId(), x: p.x, y: p.y })));
      }
    };
    dom.addEventListener('click', onClick);
    return () => dom.removeEventListener('click', onClick);
  }, [open, v.scene, bounds]);

  const useJobBounds = () => {
    const b = v.job?.bounds;
    if (!b || !Number.isFinite(b.min.x) || !Number.isFinite(b.min.y)) return;
    // pad outward: interpolation only exists strictly inside the probe hull,
    // so probing exactly the job bounds leaves edge/corner cuts unsupported
    setMinX(Math.floor(b.min.x - margin));
    setMaxX(Math.ceil(b.max.x + margin));
    setMinY(Math.floor(b.min.y - margin));
    setMaxY(Math.ceil(b.max.y + margin));
  };

  const motion = { clearanceZ, startZ, endZ, feedrate };
  const range = probe.minZ != null && probe.maxZ != null ? probe.maxZ - probe.minZ : null;
  const progress = probe.progress?.total
    ? Math.round((probe.progress.current / probe.progress.total) * 100)
    : 0;

  const probeUnmeasured = () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    setError(null);
    const targets = probe.vertices.filter((p) => !Number.isFinite(Number(p.z)));
    if (!targets.length) {
      setError('no new points to probe');
      return;
    }
    try {
      probeStore.begin('map');
      probeCommands.startPoints(targets, motion);
    } catch (err) {
      setError(err.message);
      probeStore.halt();
    }
  };

  const surface = useMemo(
    () => buildSurface(probe.vertices, probe.triangles),
    [probe.vertices, probe.triangles]
  );

  const applyCompensation = () => {
    setError(null);
    if (!v.job?.text) {
      setError('load G-code in the visualizer first');
      return;
    }
    if (surface.triangleCount === 0) {
      setError('no measured surface — probe first');
      return;
    }
    const r = compensateGcode({ text: v.job.text, surface, maxSegLen: 2 });
    if (r.outside.length) {
      setError(
        `${r.outside.length} cutting point${r.outside.length === 1 ? '' : 's'} outside the probed surface ` +
        `(first: line ${r.outside[0].line} at ${fmtAxis(r.outside[0].x)}, ${fmtAxis(r.outside[0].y)}). ` +
        'Expand or refine the mesh to cover the toolpath.'
      );
      return;
    }
    const parsed = parseGcode(r.text);
    setViz({
      job: { ...parsed, name: `${v.job.name || 'job'} (compensated)`, text: r.text },
      selection: null,
    });
  };

  const modal = open && createPortal(
    <div className="modal-backdrop side" onMouseDown={() => setOpen(false)}>
      <div className="modal-panel" role="dialog" aria-label="Autolevel setup" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Autolevel mesh</h2>
          <span className="hint">
            {probe.vertices.length} vertices · {probe.triangles.length} triangles · {measured} measured
          </span>
          <span className="spacer" />
          <button onClick={() => setOpen(false)} title="close">×</button>
        </div>
        <div className="modal-body">
          {error && <div className="error">{error}</div>}
          <div className="modal-cols">
            <section>
              <h3>Probe motion</h3>
              <div className="probe-fields cols-2">
                <NumField label="Clearance" value={clearanceZ} onChange={setClearanceZ} />
                <NumField label="Start Z" value={startZ} onChange={setStartZ} />
                <NumField label="Probe to" value={endZ} onChange={setEndZ} />
                <NumField label="Feed" value={feedrate} onChange={setFeedrate} />
              </div>
              <p className="hint">Each point rapids to clearance, drops to start Z, then probes to the end Z. First point uses half feed.</p>
            </section>
            <section>
              <h3>Board &amp; mesh</h3>
              <div className="probe-fields cols-2">
                <NumField label="Min X" value={minX} onChange={setMinX} />
                <NumField label="Max X" value={maxX} onChange={setMaxX} />
                <NumField label="Min Y" value={minY} onChange={setMinY} />
                <NumField label="Max Y" value={maxY} onChange={setMaxY} />
                <NumField label="Mesh spacing" value={spacing} onChange={(s) => setSpacing(Math.max(0.5, s))} />
                <NumField label="Job margin" value={margin} onChange={(m) => setMargin(Math.max(0, m))} title="outward padding added by Use job bounds" />
              </div>
              <div className="probe-row">
                <button disabled={!v.job} onClick={useJobBounds}>Use job bounds</button>
                <button onClick={regenerate}>Regenerate lattice</button>
              </div>
              <p className="hint">Alt+click a triangle in the 3D view to refine it. Measured points are kept.</p>
            </section>
          </div>

          <h3>Surface &amp; compensation</h3>
          <div className="probe-row">
            <span className="hint">
              {surface.triangleCount > 0
                ? `${surface.triangleCount} measured triangles · surface shown as tinted mesh over the toolpath`
                : 'no measured surface yet'}
            </span>
            <span className="spacer" />
            <button disabled={!v.job || surface.triangleCount === 0} onClick={applyCompensation}
              title="creates a compensated copy as a new job; the nominal G-code is untouched">
              Apply compensation
            </button>
          </div>
          <p className="hint">
            Cutting moves are subdivided (~2 mm) and Z-shifted onto the measured surface.
            Paths outside the probed area are rejected — expand the mesh instead.
          </p>
        </div>
        <div className="modal-foot">
          <span className="hint">
            {pending > 0 ? `${pending} new point${pending === 1 ? '' : 's'} to probe` : 'all points measured'}
            {probe.results.length > 0 && ` · Z ${fmtAxis(probe.minZ)} … ${fmtAxis(probe.maxZ)}${range != null ? ` (range ${fmtAxis(range)})` : ''}`}
          </span>
          <span className="spacer" />
          <button onClick={() => setOpen(false)}>Close</button>
          <button className="run-btn" disabled={!port || probe.running || pending === 0} onClick={probeUnmeasured}>
            {armed ? `Confirm probe (${pending})` : 'Probe new points'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );

  return (
    <section className="widget">
      <div className="widget-head">
        <h2>Autolevel</h2>
        <span className="spacer" />
        <button onClick={() => setOpen(true)}>Setup</button>
        {probe.running && probe.session === 'map' && (
          <button onClick={() => probeCommands.stop()} title="soft-resets GRBL to abort the probe">Stop</button>
        )}
      </div>
      <div className="probe-row">
        <span className="hint">{probe.vertices.length} vertices · {measured} measured</span>
        {probe.results.length > 0 && (
          <span className="hint">Z {fmtAxis(probe.minZ)} … {fmtAxis(probe.maxZ)}</span>
        )}
      </div>
      {probe.session === 'map' && probe.progress?.total > 0 && (
        <div className="progress-bar"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
      )}
      {probe.results.length > 0 && (
        <div className="probe-row">
          <button onClick={() => probeStore.clearResults()}>Clear measurements</button>
        </div>
      )}
      {modal}
    </section>
  );
}
