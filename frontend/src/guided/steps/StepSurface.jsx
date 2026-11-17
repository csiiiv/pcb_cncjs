// Guided steps 6–7 — surface probe + compensation. Lattice over job bounds,
// probe run (via wiring gate) using the same travel-optimized tour as the
// Debug autolevel, then apply/skip compensation. Completion is reconciled
// from the probe mesh and viz store.
import { useEffect, useMemo, useRef, useState } from 'react';
import { probeStore, probeCommands, useProbe, useStoreSelector, store as machineStore, machineCommands, fmtAxis } from '../../cnc/runtime.js';
import { useViz } from '../../visualizer/vizStore.js';
import { useDefaultState } from '../../settings/store.js';
import { triangularLattice } from '../../probe/lattice.js';
import { buildSurface } from '../../probe/surface.js';
import { planProbeOrder, tourLengthOf } from '../../probe/tour.js';
import { makeVertexId } from '../../probe/mesh.js';
import { refineCandidates } from '../../probe/refine.js';
import { requestProbeStart } from '../../probe/wiring.js';
import { applyJobCompensation, revertJobCompensation } from '../../visualizer/jobCompensation.js';
import { toast } from '../../ui/toast.js';
import NumField from '../../ui/NumField.jsx';
import { skipStage } from '../../workflow/session.js';

export default function StepSurface({ stage, done, session }) {
  const probe = useProbe(probeStore);
  const v = useViz();
  const activeState = useStoreSelector((s) => s.activeState);
  const portOpen = useStoreSelector((s) => Boolean(s.connectedPort));
  const pinState = useStoreSelector((s) => s.pinState);
  const [spacing, setSpacing] = useDefaultState('autolevel', 'spacing');
  const [margin, setMargin] = useDefaultState('autolevel', 'margin');
  const [clearanceZ, setClearanceZ] = useDefaultState('autolevel', 'clearanceZ');
  const [startZ, setStartZ] = useDefaultState('autolevel', 'startZ');
  const [endZ, setEndZ] = useDefaultState('autolevel', 'endZ');
  const [feedrate, setFeedrate] = useDefaultState('autolevel', 'feedrate');
  const [error, setError] = useState(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [editMode, setEditMode] = useState(null); // null | 'add' | 'refine'
  const [manual, setManual] = useState([]);
  const isSurface = stage === 'surface';

  const measured = probe.vertices.filter((p) => Number.isFinite(p.z)).length;
  const total = probe.vertices.length;
  const unmeasured = useMemo(() => probe.vertices.filter((p) => !Number.isFinite(p.z)), [probe.vertices]);
  const pending = unmeasured.length;
  const progress = probe.progress?.total ? Math.round((probe.progress.current / probe.progress.total) * 100) : 0;
  const busy = probe.running;
  const alarmed = activeState === 'Alarm' || activeState === 'Door';
  const circuitClosed = (pinState || '').includes('P');
  const jobBounds = v.job?.bounds;
  const compensated = v.compensatedJob != null && v.job?.text === v.compensatedJob.text;
  const motion = { clearanceZ, startZ, endZ, feedrate };

  const preview = useMemo(() => {
    if (!jobBounds || !Number.isFinite(jobBounds.min.x)) return null;
    return {
      minX: Math.floor(jobBounds.min.x - margin), maxX: Math.ceil(jobBounds.max.x + margin),
      minY: Math.floor(jobBounds.min.y - margin), maxY: Math.ceil(jobBounds.max.y + margin)
    };
  }, [jobBounds, margin]);

  const buildLattice = () => {
    if (!preview) { setError('load an operation preview first (previous step) so bounds are known'); return; }
    // keep manual points and already-measured lattice spots (same rules as Debug)
    const key = (x, y) => `${Math.round(x * 100)}:${Math.round(y * 100)}`;
    const keepMeasured = new Map(probe.vertices
      .filter((p) => Number.isFinite(p.z) && !p.manual)
      .map((p) => [key(p.x, p.y), p]));
    const keepManual = new Map(probe.vertices
      .filter((p) => p.manual)
      .map((p) => [key(p.x, p.y), p]));
    const lattice = triangularLattice(preview, spacing).flatMap((p) => {
      const old = keepMeasured.get(key(p.x, p.y));
      if (old) return [{ ...old }];
      if (keepManual.has(key(p.x, p.y))) return [];
      return [{ id: makeVertexId(), x: p.x, y: p.y }];
    });
    probeStore.setMesh([...lattice, ...keepManual.values()], preview);
    setError(null);
  };

  // --- travel-optimized tour (identical to Debug autolevel §10) ---
  const lastRunOrderRef = useRef(null);
  const travelInfo = useMemo(() => {
    if (busy) return lastRunOrderRef.current; // the tour actually being run
    if (unmeasured.length) {
      const wpos = machineStore.getSnapshot().wpos;
      const start = wpos ? { x: Number(wpos.x), y: Number(wpos.y) } : null;
      return { order: planProbeOrder(unmeasured, start), start };
    }
    return null;
  }, [busy, unmeasured]);

  // draw the planned tour in the 3D view while idle-planning
  useEffect(() => {
    const scene = v.scene;
    if (!scene?.setProbeOrder) return undefined;
    if (busy || pending === 0) {
      scene.setProbeOrder([]);
      return undefined;
    }
    scene.setProbeOrder(travelInfo?.order?.length >= 2 ? travelInfo.order : []);
    return () => scene.setProbeOrder([]);
  }, [busy, pending, travelInfo, v.scene]);

  const runProbe = () => {
    setError(null);
    if (alarmed) { setError('GRBL is in Alarm — unlock first'); return; }
    if (!pending) { setError('no new points to probe'); return; }
    const wpos = machineStore.getSnapshot().wpos;
    const start = wpos ? { x: Number(wpos.x), y: Number(wpos.y) } : null;
    const targets = planProbeOrder(unmeasured, start);
    lastRunOrderRef.current = { order: targets, start };
    requestProbeStart({
      kind: 'map',
      detail: `${targets.length} points`,
      run: () => {
        try {
          probeStore.begin('map');
          probeCommands.startPoints(targets, motion);
        } catch (err) {
          setError(err.message);
          probeStore.halt();
        }
      }
    });
  };

  const stopProbe = () => {
    try { probeCommands.stop(); } catch (err) { setError(err.message); }
    // store halts via controller:state Alarm watcher / workflow idle
  };

  // --- manual point placement (advanced) — same machinery as Debug ---
  const sceneRef = useRef(null);
  const modeRef = useRef(editMode);
  const candidateRef = useRef(null);
  sceneRef.current = v.scene;
  modeRef.current = editMode;

  useEffect(() => {
    const scene = v.scene;
    if (!advancedOpen || !editMode || !scene?.startPlacing) return undefined;
    scene.startPlacing(editMode === 'refine' ? 'centroid' : 'free');
    return () => scene.stopPlacing?.();
  }, [advancedOpen, editMode, v.scene]);

  useEffect(() => {
    if (!advancedOpen || !editMode) return undefined;
    const dom = document.querySelector('.viz-container canvas');
    if (!dom) return undefined;
    let down = null;
    const onMove = (e) => {
      const scene = sceneRef.current;
      if (!scene?.updatePlacing) return;
      candidateRef.current = modeRef.current === 'refine' ? candidateAt(scene, e) : null;
      scene.updatePlacing(e, candidateRef.current ?? undefined);
    };
    const onDown = (e) => { down = { x: e.clientX, y: e.clientY }; };
    const onClick = (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved >= 4 || e.button !== 0) return;
      const scene = sceneRef.current;
      if (!scene?.probeMesh) return;
      if (modeRef.current === 'refine') {
        const cand = candidateRef.current ?? candidateAt(scene, e);
        if (!cand || cand.rejected || !Number.isFinite(cand.x)) return;
        const added = probeStore.addVertices([{ id: makeVertexId(), x: cand.x, y: cand.y, manual: true }]);
        if (added.length) {
          setManual((m) => [...m, added[0]]);
          candidateRef.current = candidateAt(scene, e);
          scene.updatePlacing?.(e, candidateRef.current ?? undefined);
        }
        return;
      }
      const p = scene.probeWorldAt(e);
      if (!p) return;
      const nv = { id: makeVertexId(), x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100, manual: true };
      const added = probeStore.addVertices([nv]);
      if (added.length) setManual((m) => [...m, nv]);
    };
    dom.addEventListener('mousemove', onMove);
    dom.addEventListener('mousedown', onDown);
    dom.addEventListener('click', onClick);
    return () => {
      dom.removeEventListener('mousemove', onMove);
      dom.removeEventListener('mousedown', onDown);
      dom.removeEventListener('click', onClick);
    };
  }, [advancedOpen, editMode]);

  // never leave an edit mode armed when advanced collapses
  useEffect(() => { if (!advancedOpen) setEditMode(null); }, [advancedOpen]);

  const candidateAt = (scene, e) => {
    if (!scene?.probeMesh) return null;
    const idx = scene.probeTriangleAt(e);
    if (idx < 0) return null;
    const cands = refineCandidates({
      indices: scene.probeMesh.triangles[idx],
      vertices: scene.probeMesh.vertices,
      bounds: preview,
    });
    if (!cands.length) return { rejected: true, triangle: idx };
    return { x: cands[0].x, y: cands[0].y, triangle: idx };
  };

  const removeManual = (p) => {
    setManual((m) => m.filter((q) => q.id !== p.id));
    probeStore.removeVertex(p.id);
  };

  const latticeCount = probe.vertices.filter((p) => !p.manual).length;

  // A wiped map can no longer support a compensated toolpath.
  const dropStaleCompensation = (remainingMeasured) => {
    if (remainingMeasured >= 3 || !v.compensatedJob) return;
    try { revertJobCompensation(); } catch { /* preview already nominal */ }
  };

  const clearLattice = () => {
    const kept = probe.vertices.filter((p) => p.manual);
    probeStore.replaceMesh(kept, probe.bounds);
    setManual(kept);
    lastRunOrderRef.current = null;
    dropStaleCompensation(kept.filter((p) => Number.isFinite(p.z)).length);
    setError(null);
    toast('Lattice cleared. Manual points kept — build a new lattice to probe again.');
  };

  const clearAllPoints = () => {
    setManual([]);
    lastRunOrderRef.current = null;
    probeStore.clearMesh();
    dropStaleCompensation(0);
    setError(null);
    toast('Probe points and measurements cleared');
  };

  const applyComp = () => {
    try {
      const surface = buildSurface(probe.vertices, probe.triangles);
      if (!surface?.triangleCount) { setError('no measured surface — probe first'); return; }
      applyJobCompensation(surface);
      toast('Surface compensation applied to the previewed job');
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="gw-step">
      <p className="gw-status">
        <span className={`tag ${total ? 'ok' : ''}`}>{measured}/{total} measured</span>
        {probe.minZ != null && <span className="tag">Z {fmtAxis(probe.minZ)} … {fmtAxis(probe.maxZ)}</span>}
        {busy && <span className="tag warn">{progress}% probing</span>}
        {travelInfo && !busy && (
          <span className="tag" title="nearest-neighbor + 2-opt tour anchored at the machine XY">
            tour ~{tourLengthOf(travelInfo.order, travelInfo.start).toFixed(0)} mm
          </span>
        )}
        <span className={`tag ${circuitClosed ? 'ok' : ''}`}>{circuitClosed ? 'circuit closed' : 'circuit open'}</span>
      </p>

      {isSurface ? (
        <>
          <p className="hint">Lattice over the previewed job bounds + margin. Every point is a tool-to-board tap.</p>
          {preview ? (
            <p className="hint">Covers X {preview.minX}…{preview.maxX} · Y {preview.minY}…{preview.maxY} mm (job + {margin} mm margin).</p>
          ) : (
            <p className="hint warn">No job preview loaded — preview an operation in the Generate step first.</p>
          )}
          <div className="probe-fields cols-2">
            <NumField label="Point spacing (mm)" value={spacing} onChange={(s) => setSpacing(Math.max(0.5, s))} />
            <NumField label="Margin (mm)" value={margin} onChange={(m) => setMargin(Math.max(0, m))} />
            <NumField label="Clearance Z (mm)" value={clearanceZ} onChange={setClearanceZ} />
            <NumField label="Probe start Z (mm)" value={startZ} onChange={setStartZ} />
            <NumField label="Probe end Z (mm)" value={endZ} onChange={setEndZ} />
            <NumField label="Probe feed (mm/min)" value={feedrate} onChange={setFeedrate} />
          </div>
          <div className="gw-actions">
            <button onClick={buildLattice} disabled={busy || !preview}>Build lattice</button>
            <button
              className="primary"
              disabled={busy || !pending}
              onClick={runProbe}
            >Probe {pending} points</button>
            {busy && <button onClick={stopProbe}>Stop</button>}
          </div>
          <div className="gw-actions">
            <button
              disabled={busy || latticeCount === 0}
              onClick={clearLattice}
              title="Remove the generated lattice and its probe values. Manually placed points stay."
            >Clear lattice</button>
            <button
              disabled={busy || (total === 0 && probe.results.length === 0 && probe.minZ == null)}
              onClick={clearAllPoints}
              title="Remove every probe point, measurement, and autolevel result"
            >Clear all points</button>
          </div>

          {/* interrupted mid-pass: offer unlock + resume (soft-reset on stop
              leaves GRBL in Alarm; wiring gate re-checks on every restart) */}
          {!busy && pending > 0 && measured > 0 && alarmed && (
            <div className="preflight warn">
              <span>Probe interrupted — {pending} point{pending === 1 ? '' : 's'} unmeasured.</span>
              <button className="inline" disabled={!portOpen} onClick={() => { try { machineCommands.unlock(); } catch { /* already unlocked */ } }}>Unlock ($X)</button>
              <button className="inline" disabled={!portOpen} onClick={runProbe}>Resume probing ({pending})</button>
            </div>
          )}

          {!done && !busy && (
            <button
              className="gw-skip-btn"
              onClick={() => { skipStage('surface', 'operator skipped'); toast('Surface probe skipped — recorded', 'warn'); }}
              title="Record an explicit skip decision"
            >Skip — run nominal</button>
          )}
          {done && <p className="hint">Surface measured — compensation is next.</p>}
        </>
      ) : (
        <>
          <p className="hint">Compensation Z-shifts every cutting move onto the measured surface (~2 mm subdivision). Paths outside the probed hull are rejected.</p>
          <div className="gw-actions">
            <button className="primary" disabled={!measured || busy} onClick={applyComp} title={measured ? 'shift cutting Z onto the measured surface' : 'probe the surface first'}>
              {compensated ? 'Reapply compensation' : 'Apply compensation'}
            </button>
            {compensated && (
              <button disabled={busy} onClick={() => { revertJobCompensation(); setError(null); }}>Revert</button>
            )}
            <button onClick={() => { skipStage('compensated', 'operator skipped'); toast('Compensation skipped — cutting nominal', 'warn'); }}>
              Skip — run nominal
            </button>
          </div>
          <p className="hint">
            {compensated ? 'Compensated job is previewed — it is what the sender must hold at start time.' : 'Skipping means every Z assumes a perfectly flat board.'}
          </p>
        </>
      )}

      {/* advanced: manual point placement + mesh management */}
      <div className="gw-advanced">
        <button className="gw-advanced-toggle" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((o) => !o)}>
          <span className={`mp-caret ${advancedOpen ? 'open' : ''}`}>▸</span> Advanced mesh setup
          <span className="hint"> · {manual.length} manual · {total} vertices</span>
        </button>
        {advancedOpen && (
          <div className="gw-advanced-body">
            <p className="hint">
              Toggle a mode, then click in the 3D view — a crosshair follows the mouse.
              <b> Free point</b> places a vertex at the crosshair; <b>centroid</b> snaps to the engine's
              candidate for the triangle you click. Dragging orbits; it never places points.
            </p>
            <div className="probe-row">
              <span className="seg">
                <button className={editMode === 'add' ? 'on' : ''} disabled={busy}
                  onClick={() => setEditMode((m) => (m === 'add' ? null : 'add'))}>
                  {editMode === 'add' ? 'Placing free point…' : 'Add Free Point'}
                </button>
                <button className={editMode === 'refine' ? 'on' : ''} disabled={busy}
                  onClick={() => setEditMode((m) => (m === 'refine' ? null : 'refine'))}>
                  {editMode === 'refine' ? 'Placing centroid point…' : 'Add Centroid Point'}
                </button>
              </span>
            </div>
            {manual.length > 0 && (
              <div className="probe-list">
                {manual.map((p) => (
                  <div className="probe-row" key={p.id}>
                    <span className="hint">{fmtAxis(p.x)}, {fmtAxis(p.y)}{Number.isFinite(p.z) ? ` · Z ${fmtAxis(p.z)}` : ''}</span>
                    <span className="spacer" />
                    <button onClick={() => removeManual(p)}>Remove</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {error && <div className="error">{error}</div>}
      {busy && (
        <div className="run-progress">
          <div className="progress-bar"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
        </div>
      )}
    </div>
  );
}
