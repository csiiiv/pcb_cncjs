import { ParameterLabel } from '../ui/InfoIcon.jsx';
import { parameterHelp } from '../ui/parameterHelp.js';
import { useDefaultState } from '../settings/store.js';
// Autolevel: authoritative probe mesh (vertices + Delaunay triangles).
// Dock slot = summary; Setup opens the modal mesh editor.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStoreSelector, probeStore, probeCommands, useProbe, fmtAxis, store, machineCommands } from '../cnc/runtime.js';
import { useViz, setVizPref } from '../visualizer/vizStore.js';
import { applyJobCompensation, revertJobCompensation } from '../visualizer/jobCompensation.js';
import { COLORMAPS, legendGradient } from '../probe/colormap.js';
import { triangularLattice } from '../probe/lattice.js';
import { refineCandidates } from '../probe/refine.js';
import { makeVertexId, hullCoversBounds } from '../probe/mesh.js';
import { buildSurface } from '../probe/surface.js';
import { planProbeOrder, tourLengthOf } from '../probe/tour.js';
import { requestProbeStart } from '../probe/wiring.js';
import { serializeHeightmap, parseHeightmap, downloadHeightmap } from '../probe/heightmapFile.js';
import HeightmapCompareModal from './HeightmapCompareModal.jsx';
import RepeatabilityTestModal from './RepeatabilityTestModal.jsx';
import { ResizeEdge, useModalStack, useModalWidth, isTopModal } from '../ui/ModalKit.jsx';
import NumField from '../ui/NumField.jsx';

export default function AutolevelWidget() {
  const port = useStoreSelector((s) => s.connectedPort);
  const activeState = useStoreSelector((s) => s.activeState);
  const workflow = useStoreSelector((s) => s.workflowState);
  const jobBusy = ['running', 'paused'].includes(workflow);
  const probe = useProbe(probeStore);
  const v = useViz();
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [clearArmed, setClearArmed] = useState(false);
  const [error, setError] = useState(null);

  const [clearanceZ, setClearanceZ] = useDefaultState('autolevel', 'clearanceZ');
  const [startZ, setStartZ] = useDefaultState('autolevel', 'startZ');
  const [endZ, setEndZ] = useDefaultState('autolevel', 'endZ');
  const [feedrate, setFeedrate] = useDefaultState('autolevel', 'feedrate');
  const [minX, setMinX] = useDefaultState('autolevel', 'minX');
  const [maxX, setMaxX] = useDefaultState('autolevel', 'maxX');
  const [minY, setMinY] = useDefaultState('autolevel', 'minY');
  const [maxY, setMaxY] = useDefaultState('autolevel', 'maxY');
  const [spacing, setSpacing] = useDefaultState('autolevel', 'spacing');
  const [margin, setMargin] = useDefaultState('autolevel', 'margin');
  const [manual, setManual] = useState([]); // click-placed points: {id,x,y}
  const [editMode, setEditMode] = useState(null); // null | 'add' | 'refine'
  const [compareOpen, setCompareOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const loadFileRef = useRef(null);
  const [modalWidth, setModalWidth] = useModalWidth('autolevel', 400);
  useModalStack(open, 'autolevel');

  // normalize so partially-typed / inverted bounds can't poison refine + lattice
  const bounds = {
    minX: Math.min(minX, maxX),
    maxX: Math.max(minX, maxX),
    minY: Math.min(minY, maxY),
    maxY: Math.max(minY, maxY),
  };
  const measured = probe.vertices.filter((p) => Number.isFinite(Number(p.z))).length;
  const pending = probe.vertices.length - measured;

  // Live coverage pre-check: cutting moves outside the probe hull get REJECTED
  // by compensation only after a full probe pass. Catch it now instead.
  const coverage = useMemo(() => {
    if (!v.job?.bounds || probe.vertices.length < 3) return null;
    return hullCoversBounds(probe.vertices, {
      minX: v.job.bounds.min.x, maxX: v.job.bounds.max.x,
      minY: v.job.bounds.min.y, maxY: v.job.bounds.max.y
    });
  }, [v.job, probe.vertices]);
  const uncovered = coverage && !coverage.covered && probe.running === false;

  // Rebuild the lattice from bounds + spacing. Measured lattice vertices are
  // preserved when their position still exists in the new lattice; manual /
  // refine-placed vertices ALWAYS survive — they are placement intent, not
  // derived from bounds/spacing, so a rebuild must never drop them.
  const regenerate = useCallback(() => {
    const key = (x, y) => `${Math.round(x * 100)}:${Math.round(y * 100)}`;
    const keepMeasured = new Map(probe.vertices
      .filter((p) => Number.isFinite(Number(p.z)) && !p.manual)
      .map((p) => [key(p.x, p.y), p]));
    const keepManual = new Map(probe.vertices
      .filter((p) => p.manual)
      .map((p) => [key(p.x, p.y), p]));
    const lattice = triangularLattice(bounds, spacing).flatMap((p) => {
      const old = keepMeasured.get(key(p.x, p.y));
      if (old) return [{ ...old }];
      // don't duplicate a manual vertex sitting exactly on a lattice spot
      if (keepManual.has(key(p.x, p.y))) return [];
      return [{ id: makeVertexId(), x: p.x, y: p.y }];
    });
    probeStore.setMesh([...lattice, ...keepManual.values()], bounds);
  }, [minX, maxX, minY, maxY, spacing, probe.vertices]);

  const regenerateRef = useRef(regenerate);
  regenerateRef.current = regenerate;

  // Closing the modal applies any bounds/spacing edits — but ONLY if they
  // changed since the modal opened. An unconditional rebuild on every close
  // would drop manually placed points (now preserved) and unmeasured lattice
  // points (disposable), so we snapshot on open and diff on close.
  const lastAppliedRef = useRef(null);
  useEffect(() => {
    if (open) {
      // freeze the values as they were when the modal session began (only
      // on the false→true transition; later edits while open keep it)
      if (lastAppliedRef.current === null) {
        lastAppliedRef.current = { minX, maxX, minY, maxY, spacing };
      }
      return;
    }
    const last = lastAppliedRef.current;
    if (last === null) return; // never opened yet — nothing to apply
    const changed = last.minX !== minX || last.maxX !== maxX || last.minY !== minY
      || last.maxY !== maxY || last.spacing !== spacing;
    lastAppliedRef.current = null; // consumed
    if (changed) regenerateRef.current();
  }, [open, minX, maxX, minY, maxY, spacing]);

  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  useEffect(() => {
    if (!clearArmed) return undefined;
    const t = setTimeout(() => setClearArmed(false), 4000);
    return () => clearTimeout(t);
  }, [clearArmed]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && isTopModal('autolevel')) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // never leave an edit mode armed after the editor closes
  useEffect(() => {
    if (!open) setEditMode(null);
  }, [open]);

  // Refs keep the canvas listeners stable: #maybeSelect fires setViz on every
  // plain mousedown (selection change → re-render), and re-subscribing the
  // listeners mid-click loses the mousedown→click pairing, silently eating
  // the click. With refs, mount/unmount depends only on the modal being open.
  const sceneRef = useRef(null);
  const boundsRef = useRef(bounds);
  const modeRef = useRef(editMode);
  sceneRef.current = v.scene;
  boundsRef.current = bounds;
  modeRef.current = editMode;

  // The candidate previewed under the mouse (centroid mode). Clicking commits
  // exactly what the preview shows — no re-computation surprises.
  const candidateRef = useRef(null);

  // Compute the refine-engine candidate for the triangle under a mouse
  // event. Returns { x, y, triangle } or a { rejected, triangle } marker.
  const candidateAt = (scene, e) => {
    if (!scene?.probeMesh) return null;
    const idx = scene.probeTriangleAt(e);
    if (idx < 0) return null;
    const cands = refineCandidates({
      indices: scene.probeMesh.triangles[idx],
      vertices: scene.probeMesh.vertices,
      bounds: boundsRef.current,
    });
    if (!cands.length) return { rejected: true, triangle: idx };
    return { x: cands[0].x, y: cands[0].y, triangle: idx };
  };

  // Mode cursor lifecycle: attach the placement crosshair when a mode is on.
  useEffect(() => {
    const scene = v.scene;
    if (!open || !editMode || !scene?.startPlacing) return undefined;
    scene.startPlacing(editMode === 'refine' ? 'centroid' : 'free');
    return () => scene.stopPlacing?.();
  }, [open, editMode, v.scene]);

  // Mesh edit mode (auto_level.md §7): "add" places a vertex exactly where
  // you click; "refine" commits the engine's candidate point (centroid /
  // longest-edge midpoint) inside the triangle you click — the exact point
  // the preview crosshair shows. Plain-click modes replace Alt+click, which
  // Linux window managers swallow as window drag. A mousedown→mouseup move
  // of ~4px or more counts as orbit/pan, not a click, so view adjustments
  // never place points.
  useEffect(() => {
    const dom = document.querySelector('.viz-container canvas');
    if (!dom || !open) return undefined;
    let down = null;
    const onMove = (e) => {
      if (!modeRef.current) return;
      const scene = sceneRef.current;
      if (!scene?.updatePlacing) return;
      candidateRef.current = modeRef.current === 'refine' ? candidateAt(scene, e) : null;
      scene.updatePlacing(e, candidateRef.current ?? undefined);
    };
    const onDown = (e) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onClick = (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      const mode = modeRef.current;
      if (!mode || moved >= 4 || e.button !== 0) return;
      const scene = sceneRef.current;
      if (!scene?.probeMesh) return;
      if (mode === 'refine') {
        const cand = candidateRef.current ?? candidateAt(scene, e);
        if (!cand || cand.rejected || !Number.isFinite(cand.x)) return;
        const added = probeStore.addVertices([{ id: makeVertexId(), x: cand.x, y: cand.y, manual: true }]);
        if (added.length) {
          setManual((m) => [...m, added[0]]);
          // refresh preview against the retriangulated mesh (usually turns
          // red here: the new vertex is now inside minSpacing)
          candidateRef.current = candidateAt(scene, e);
          scene.updatePlacing?.(e, candidateRef.current ?? undefined);
        }
        return;
      }
      // 'add': exact placement at the clicked world coordinate
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
  }, [open]);

  const clearAllPoints = () => {
    if (!clearArmed) {
      setClearArmed(true);
      return;
    }
    setClearArmed(false);
    lastRunOrderRef.current = null;
    setManual([]);
    probeStore.clearMesh();
  };

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

  // Optimized visiting order for the pending points, anchored at the current
  // machine XY. Shown while armed (confirm step) and whenever the persistent
  // travel-path toggle is on. During a run the sent tour is shown instead.
  const lastRunOrderRef = useRef(null); // order actually sent to the machine

  const travelInfo = useMemo(() => {
    if (probe.running) {
      return lastRunOrderRef.current; // the tour actually being executed
    }
    if (!armed && !v.prefs.showTravel) return null; // nobody's watching
    const unmeasured = probe.vertices.filter((p) => !Number.isFinite(Number(p.z)));
    if (unmeasured.length) {
      const wpos = store.getSnapshot().wpos;
      const start = wpos ? { x: Number(wpos.x), y: Number(wpos.y) } : null;
      return { order: planProbeOrder(unmeasured, start), start };
    }
    // all measured — keep the completed tour up for review
    return lastRunOrderRef.current;
  }, [armed, probe.vertices, probe.running, v.prefs.showTravel]);

  // Draw the travel line while armed or toggled on; clear otherwise.
  useEffect(() => {
    const scene = v.scene;
    if (!scene?.setProbeOrder) return undefined;
    if (!armed && !v.prefs.showTravel) {
      scene.setProbeOrder([]);
      return undefined;
    }
    scene.setProbeOrder(travelInfo?.order?.length >= 2 ? travelInfo.order : []);
    return () => scene.setProbeOrder([]);
  }, [armed, v.prefs.showTravel, travelInfo, v.scene]);

  const probeUnmeasured = () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    setError(null);
    const unmeasured = probe.vertices.filter((p) => !Number.isFinite(Number(p.z)));
    if (!unmeasured.length) {
      setError('no new points to probe');
      return;
    }
    // travel-optimized order: nearest-neighbor+2-opt vs serpentine vs exact
    // (small sets), anchored at the live machine XY. Order affects travel
    // only — results are matched back to vertices by coordinates.
    const wpos = store.getSnapshot().wpos;
    const start = wpos ? { x: Number(wpos.x), y: Number(wpos.y) } : null;
    const targets = planProbeOrder(unmeasured, start);
    lastRunOrderRef.current = { order: targets, start };
    requestProbeStart({
      kind: 'map',
      detail: `${targets.length} point${targets.length === 1 ? '' : 's'}`,
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

  const surface = useMemo(
    () => buildSurface(probe.vertices, probe.triangles),
    [probe.vertices, probe.triangles]
  );

  const removeManual = (p) => {
    setManual((m) => m.filter((q) => q.id !== p.id));
    probeStore.removeVertex(p.id); // actually deletes the mesh vertex
  };

  // Load a saved heightmap: its measured points become the mesh (as manual
  // vertices, so they survive regenerates), keeping their measurements.
  const loadHeightmapFile = async (file) => {
    try {
      const hm = parseHeightmap(JSON.parse(await file.text()));
      if (hm.bounds) {
        setMinX(hm.bounds.minX); setMaxX(hm.bounds.maxX);
        setMinY(hm.bounds.minY); setMaxY(hm.bounds.maxY);
      }
      const verts = hm.points.map((p) => ({ id: makeVertexId(), x: p.x, y: p.y, z: p.z, manual: true }));
      probeStore.setMesh(verts, hm.bounds || bounds);
      setManual(verts); // same objects — Remove works on the real ids
      setError(null);
    } catch (err) {
      setError(`load map: ${err.message}`);
    }
  };

  const applyCompensation = () => {
    setError(null);
    if (['running', 'paused'].includes(store.getSnapshot().workflowState)) return;
    try { applyJobCompensation(surface); }
    catch (err) { setError(err.message); }
  };

  if (open || compareOpen || testOpen) return createPortal(
    <>
      {open && (
        <div className="modal-backdrop side" onMouseDown={() => setOpen(false)}>
          <div
            className="modal-panel"
            role="dialog"
            aria-label="Autolevel setup"
            style={{ width: modalWidth }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <ResizeEdge width={modalWidth} setWidth={setModalWidth} />
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
          {uncovered && (
            <div className="preflight warn">
              Probe mesh does not cover the whole job — {coverage.missing.length} of 4 corners outside.
              Compensation will reject those cutting moves. Use job bounds + margin, or expand Min/Max.
            </div>
          )}
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
                <NumField label="Job margin" help={parameterHelp('autolevel', 'margin')} value={margin} onChange={(m) => setMargin(Math.max(0, m))} title="outward padding added by Use job bounds" />
              </div>
              <div className="probe-row">
                <button disabled={!v.job} onClick={useJobBounds}>Use job bounds</button>
                <button onClick={regenerate}>Regenerate lattice</button>
                <button
                  disabled={probe.running || probe.vertices.length === 0}
                  onClick={clearAllPoints}
                  title="remove every probe point and measurement so the map can be rebuilt"
                >
                  {clearArmed ? 'Confirm clear' : 'Clear all points'}
                </button>
              </div>
              <p className="hint">
                Toggle a mode, then click in the 3D view — a crosshair follows the mouse: <b>Add Free Point</b> places a vertex exactly at the crosshair; <b>Add Centroid Point</b> snaps to the engine's candidate (orange dot = where the point lands, outlined triangle = target; red = no valid candidate). Orbit/pan/zoom still work — dragging never places points.
              </p>
              <h3>Manual points</h3>
              <div className="probe-row">
                <span className="seg">
                  <button
                    className={editMode === 'add' ? 'on' : ''}
                    onClick={() => setEditMode((m) => (m === 'add' ? null : 'add'))}
                    title="click in the 3D view to place a probe vertex at the exact crosshair position"
                  >
                    {editMode === 'add' ? 'Placing free point…' : 'Add Free Point'}
                  </button>
                  <button
                    className={editMode === 'refine' ? 'on' : ''}
                    onClick={() => setEditMode((m) => (m === 'refine' ? null : 'refine'))}
                    title="click a triangle in the 3D view; the engine inserts its candidate point at the previewed spot"
                  >
                    {editMode === 'refine' ? 'Placing centroid point…' : 'Add Centroid Point'}
                  </button>
                </span>
                {manual.length > 0 && <span className="hint">{manual.length} placed</span>}
              </div>
              {manual.length > 0 && (
                <div className="probe-list">
                  {manual.map((p) => (
                    <div className="probe-row" key={p.id}>
                      <span className="hint">{fmtAxis(p.x)}, {fmtAxis(p.y)}</span>
                      <span className="spacer" />
                      <button onClick={() => removeManual(p)}>Remove</button>
                    </div>
                  ))}
                </div>
              )}
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
            <button disabled={jobBusy || !v.nominalJob || surface.triangleCount === 0} onClick={applyCompensation}
              title="recomputes compensation from the original G-code">
              {v.compensatedJob ? 'Reapply compensation' : 'Apply compensation'}
            </button>
            {v.compensatedJob && <button disabled={jobBusy} onClick={() => {
              if (!['running', 'paused'].includes(store.getSnapshot().workflowState)) {
                revertJobCompensation(); setError(null);
              }
            }}>Revert compensation</button>}
          </div>
          <p className="hint">
            Cutting moves are subdivided (~2 mm) and Z-shifted onto the measured surface.
            Paths outside the probed area are rejected — expand the mesh instead.
          </p>

          <h3>Height map display</h3>
          <div className="probe-fields cols-2">
            <label>
              <ParameterLabel label="Colormap" help={parameterHelp('visualizer', 'colormap')} />
              <select
                value={v.prefs.colormap}
                onChange={(e) => setVizPref('colormap', e.target.value)}
              >
                {Object.entries(COLORMAPS).map(([name, def]) => (
                  <option key={name} value={name}>{def.label}</option>
                ))}
              </select>
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={v.prefs.showZLabels}
                onChange={(e) => setVizPref('showZLabels', e.target.checked)}
              />
              <ParameterLabel label="Show probe Z at vertices" help={parameterHelp('visualizer', 'showZLabels')} />
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={v.prefs.showTravel}
                onChange={(e) => setVizPref('showTravel', e.target.checked)}
              />
              <ParameterLabel label="Show travel path" help={parameterHelp('visualizer', 'showTravel')} />
            </label>
          </div>
          {probe.results.length > 0 && probe.minZ != null && (
            <div className="probe-row legend-row">
              <span className="legend-swatch" style={{ background: legendGradient(v.prefs.colormap) }} />
              <span className="hint">Z {fmtAxis(probe.minZ)} … {fmtAxis(probe.maxZ)}</span>
            </div>
          )}
        </div>
        <div className="modal-foot">
          <span className="hint">
            {armed && travelInfo
              ? `probe tour: ${travelInfo.order.length} points · ~${tourLengthOf(travelInfo.order, travelInfo.start).toFixed(0)} mm XY travel`
              : pending > 0
                ? `${pending} new point${pending === 1 ? '' : 's'} to probe`
                : 'all points measured'}
            {probe.results.length > 0 && ` · Z ${fmtAxis(probe.minZ)} … ${fmtAxis(probe.maxZ)}${range != null ? ` (range ${fmtAxis(range)})` : ''}`}
          </span>
          <span className="spacer" />
          <button onClick={() => setTestOpen(true)} title="probe the same spot repeatedly to measure repeatability">Test…</button>
          <button onClick={() => setOpen(false)}>Close</button>
          <button className="run-btn" disabled={!port || probe.running || pending === 0} onClick={probeUnmeasured}>
            {armed ? `Confirm probe (${pending})` : 'Probe new points'}
          </button>
        </div>
          </div>
        </div>
      )}
      {/* sub-modals mount in the same portal so they layer ABOVE the autolevel
          modal (portal children stack in mount order); rendered here instead
          of the dock branch so they open even while this modal is closed */}
      <HeightmapCompareModal open={compareOpen} onClose={() => setCompareOpen(false)} />
      <RepeatabilityTestModal
        open={testOpen}
        onClose={() => setTestOpen(false)}
        motionDefaults={{ clearanceZ, startZ, endZ, feedrate }}
      />
    </>,
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
      {/* Probe interrupted mid-pass (alarm/stop/port loss): unmeasured points
          remain. Offer one-click unlock + resume instead of leaving the map
          half-built with no explanation. */}
      {!probe.running && pending > 0 && measured > 0 && activeState === 'Alarm' && (
        <div className="preflight warn">
          <span>
            Probe interrupted — {pending} point{pending === 1 ? '' : 's'} unmeasured.
          </span>
          <button
            className="inline"
            disabled={!port}
            onClick={() => {
              try { machineCommands.unlock(); } catch { /* already unlocked */ }
            }}
          >
            Unlock ($X)
          </button>
          <button className="inline" disabled={!port} onClick={probeUnmeasured}>
            Resume probing ({pending})
          </button>
        </div>
      )}
      {uncovered && (
        <div className="preflight warn" title="cutting moves outside the probe hull are rejected during compensation">
          <span>
            Probe mesh does not cover the whole job ({coverage.missing.length} corner{coverage.missing.length === 1 ? '' : 's'} outside).
          </span>
          <button className="inline" onClick={() => setOpen(true)}>Expand mesh…</button>
        </div>
      )}
      <div className="probe-row">
        <span className="hint">{probe.vertices.length} vertices · {measured} measured</span>
        {probe.results.length > 0 && (
          <span className="hint">Z {fmtAxis(probe.minZ)} … {fmtAxis(probe.maxZ)}</span>
        )}
      </div>
      {probe.session === 'map' && probe.progress?.total > 0 && (
        <div className="progress-bar"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
      )}
      {(probe.vertices.length > 0 || probe.results.length > 0) && (
        <div className="probe-row">
          {probe.results.length > 0 && (
            <button onClick={() => probeStore.clearResults()}>Clear measurements</button>
          )}
          {probe.vertices.length > 0 && (
            <button
              disabled={probe.running}
              onClick={clearAllPoints}
              title="remove every probe point and measurement so the map can be rebuilt"
            >
              {clearArmed ? 'Confirm clear' : 'Clear all points'}
            </button>
          )}
        </div>
      )}
      <div className="probe-row">
        <button
          disabled={measured < 3}
          title={measured < 3 ? 'need at least 3 measured points' : 'download the measured points as .heightmap.json'}
          onClick={() => downloadHeightmap(serializeHeightmap({
            name: `${v.job?.name ? v.job.name.replace(/\.[^.]*$/, '') + '-' : ''}map-${new Date().toISOString().slice(0, 16).replace('T', '_')}`,
            bounds: probe.bounds,
            spacing,
            vertices: probe.vertices,
          }))}
        >
          Save map
        </button>
        <button onClick={() => loadFileRef.current?.click()} title="load a saved heightmap into the current mesh">Load map</button>
        <input
          ref={loadFileRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) loadHeightmapFile(f);
            e.target.value = '';
          }}
        />
        <button onClick={() => setCompareOpen(true)} title="compare two saved heightmaps for reproducibility">Compare…</button>
      </div>
      <HeightmapCompareModal open={compareOpen} onClose={() => setCompareOpen(false)} />
    </section>
  );
}
