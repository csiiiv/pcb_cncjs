import { ParameterLabel } from '../ui/InfoIcon.jsx';
import { parameterHelp } from '../ui/parameterHelp.js';
import { getDefaults, useDefaultState } from '../settings/store.js';
// Repeatability test modal: probe one or more spots N times each, then
// report per-spot and pooled σ / range (GR&R-lite) so probe quality is
// measurable before trusting autolevel compensation.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useViz } from '../visualizer/vizStore.js';
import { useStoreSelector, probeStore, probeCommands, useProbe, fmtAxis, store } from '../cnc/runtime.js';
import { repeatability } from '../probe/repeatability.js';
import { makeVertexId } from '../probe/mesh.js';
import { requestProbeStart } from '../probe/wiring.js';
import NumField from '../ui/NumField.jsx';
import { ResizeEdge, useModalStack, useModalWidth, isTopModal } from '../ui/ModalKit.jsx';

const GRADE_CLASS = { excellent: 'grade-good', good: 'grade-good', fair: 'grade-warn', poor: 'grade-bad' };

/** Visiting order drawn on the toolpath. Repeats of the same XY collapse visually. */
function testPath(spots, mode, attempts) {
  const n = Math.max(2, attempts);
  const path = [];
  if (mode === 'burst') {
    for (const s of spots) path.push({ x: s.x, y: s.y });
  } else {
    for (let pass = 0; pass < n; pass++) {
      for (const s of spots) path.push({ x: s.x, y: s.y });
    }
  }
  return path;
}

export default function RepeatabilityTestModal({ open, onClose, motionDefaults }) {
  const v = useViz();
  const port = useStoreSelector((s) => s.connectedPort);
  const probe = useProbe(probeStore);

  const [motion, setMotion] = useState(() => ({
    ...getDefaults('autolevel'), ...motionDefaults
  }));
  const [attempts, setAttempts] = useDefaultState('autolevel', 'attempts');
  const [mode, setMode] = useDefaultState('autolevel', 'mode'); // 'burst' | 'cycled'
  const [spots, setSpots] = useState([]); // {id, x, y}
  const [pickMode, setPickMode] = useState(false);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState(null);
  const [modalWidth, setModalWidth] = useModalWidth('repeatability', 420);
  useModalStack(open, 'repeatability');

  const sceneRef = useRef(null);
  const modeRef = useRef(pickMode);
  sceneRef.current = v.scene;
  modeRef.current = pickMode;

  useEffect(() => {
    if (!open) {
      setArmed(false);
      setPickMode(false);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && isTopModal('repeatability')) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // spot picking: plain click on the PCB plane while pick mode is on
  // (same drag-vs-click discrimination as the mesh editor)
  useEffect(() => {
    const dom = document.querySelector('.viz-container canvas');
    if (!dom || !open) return undefined;
    let down = null;
    const onDown = (e) => { down = { x: e.clientX, y: e.clientY }; };
    const onClick = (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (!modeRef.current || moved >= 4 || e.button !== 0) return;
      const p = sceneRef.current?.probeWorldAt?.(e);
      if (!p) return;
      const spot = { id: makeVertexId(), x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 };
      setSpots((s) => (s.some((q) => Math.hypot(q.x - spot.x, q.y - spot.y) < 1) ? s : [...s, spot]));
    };
    dom.addEventListener('mousedown', onDown);
    dom.addEventListener('click', onClick);
    return () => {
      dom.removeEventListener('mousedown', onDown);
      dom.removeEventListener('click', onClick);
    };
  }, [open]);

  // disarm after 4s like the map probe
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  // Crosshair while picking; persistent spot markers + visit path otherwise.
  useEffect(() => {
    const scene = v.scene;
    if (!open || !pickMode || !scene?.startPlacing) return undefined;
    scene.startPlacing('free');
    return () => scene.stopPlacing?.();
  }, [open, pickMode, v.scene]);

  useEffect(() => {
    const scene = v.scene;
    if (!scene?.setRepeatTest) return undefined;
    if (!open) {
      scene.setRepeatTest([], []);
      return undefined;
    }
    scene.setRepeatTest(spots, testPath(spots, mode, attempts));
    return () => scene.setRepeatTest([], []);
  }, [open, spots, mode, attempts, v.scene]);

  if (!open) return null;

  const running = probe.running && probe.session === 'test';
  const rep = probe.session === 'test' && probe.testLog?.length
    ? repeatability(probe.testLog)
    : null;
  // mode the running/last run used (store remembers it; falls back to UI state)
  const runMode = probe.testMode || mode;
  const maxN = rep ? Array.from({ length: Math.max(...rep.spots.map((s) => s.n)) }) : [];

  // heat tint for a cell: 0..1 within its spot's min..max (flat spot → mid).
  // Light tints (blue-200 → red-200) so the dark cell text stays readable.
  const cellHeat = (z, s) => (s.range < 1e-9 ? 0.5 : (z - s.min) / s.range);
  const heatColor = (t) => `rgb(${Math.round(191 + 63 * t)} ${Math.round(219 - 17 * t)} ${Math.round(254 - 52 * t)})`;

  const startTest = () => {
    if (!armed) { setArmed(true); return; }
    setArmed(false);
    setError(null);
    if (!spots.length) { setError('pick at least one test spot'); return; }
    if (attempts < 2) { setError('need at least 2 attempts per spot'); return; }
    // Build the flat point list per design:
    //   burst  — spot1 ×N, spot2 ×N, …      minimal travel; shows settling
    //   cycled — spot1..spotK, ×N passes    time-separated visits per spot;
    //            drift between passes exposes thermal/mechanical shift
    // groupAttempts() re-clusters by XY either way.
    const points = [];
    if (mode === 'burst') {
      for (const s of spots) {
        for (let i = 0; i < attempts; i++) points.push({ x: s.x, y: s.y });
      }
    } else {
      for (let pass = 0; pass < attempts; pass++) {
        for (const s of spots) points.push({ x: s.x, y: s.y });
      }
    }
    requestProbeStart({
      kind: 'test',
      detail: `${spots.length} spot${spots.length === 1 ? '' : 's'} × ${attempts}`,
      run: () => {
        try {
          probeStore.begin('test', { mode });
          probeCommands.startPoints(points, motion);
        } catch (err) {
          setError(err.message);
          probeStore.halt();
        }
      }
    });
  };

  const f = (x) => (Number.isFinite(x) ? x.toFixed(3) : '—');

  return createPortal(
    <div className="modal-backdrop side" onMouseDown={onClose}>
      <div
        className="modal-panel"
        role="dialog"
        aria-label="Probe repeatability test"
        style={{ width: modalWidth }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <ResizeEdge width={modalWidth} setWidth={setModalWidth} />
        <div className="modal-head">
          <h2>Repeatability test</h2>
          <span className="hint">probe the same spot N times — measures σ / range</span>
          <span className="spacer" />
          {running && <button onClick={() => probeCommands.stop()}>Stop</button>}
          <button onClick={onClose} title="close">×</button>
        </div>
        <div className="modal-body">
          {error && <div className="error">{error}</div>}
          {running && probe.progress?.total > 0 && (
            <div className="progress-bar"><div className="progress-fill" style={{ width: `${Math.round((probe.progress.current / probe.progress.total) * 100)}%` }} /></div>
          )}

          <div className="modal-cols">
            <section>
              <h3>Test spots</h3>
              <div className="probe-row">
                <button className={pickMode ? 'on' : ''} onClick={() => setPickMode((p) => !p)}>
                  {pickMode ? 'Picking — click view' : 'Pick spot in view'}
                </button>
                {spots.length > 0 && (
                  <>
                    <span className="hint">{spots.length} spot{spots.length === 1 ? '' : 's'}</span>
                    <button onClick={() => setSpots([])}>Clear</button>
                  </>
                )}
              </div>
              {spots.length > 0 && (
                <div className="probe-list">
                  {spots.map((s, i) => (
                    <div className="probe-row" key={s.id}>
                      <span className="hint">#{i + 1} {fmtAxis(s.x)}, {fmtAxis(s.y)}</span>
                      <span className="spacer" />
                      <button onClick={() => setSpots((q) => q.filter((t) => t.id !== s.id))}>Remove</button>
                    </div>
                  ))}
                </div>
              )}
              <p className="hint">Pick spots on flat, representative areas — same feed and depth as your real map.</p>
              <div className="probe-fields cols-2">
                <label>
                  <ParameterLabel label="Sequence" help={parameterHelp('autolevel', 'mode')} />
                  <select value={mode} onChange={(e) => setMode(e.target.value)}>
                    <option value="burst">Burst — same spot ×N, then next</option>
                    <option value="cycled">Cycled — all spots per pass, ×N passes</option>
                  </select>
                </label>
                <NumField
                  label={mode === 'burst' ? 'Attempts / spot' : 'Passes (each spot probed per pass)'}
                  value={attempts}
                  onChange={(a) => setAttempts(Math.max(2, Math.min(50, a)))}
                />
              </div>
              <p className="hint">
                {mode === 'burst'
                  ? 'Burst: fastest, least travel — shows settling and contact repeatability.'
                  : 'Cycled: visits are time-separated — drift column exposes thermal / mechanical shift between passes.'}
              </p>
            </section>
            <section>
              <h3>Probe motion</h3>
              <div className="probe-fields cols-2">
                <NumField label="Clearance" value={motion.clearanceZ} onChange={(clearanceZ) => setMotion((m) => ({ ...m, clearanceZ }))} />
                <NumField label="Start Z" value={motion.startZ} onChange={(startZ) => setMotion((m) => ({ ...m, startZ }))} />
                <NumField label="Probe to" value={motion.endZ} onChange={(endZ) => setMotion((m) => ({ ...m, endZ }))} />
                <NumField label="Feed" value={motion.feedrate} onChange={(feedrate) => setMotion((m) => ({ ...m, feedrate }))} />
              </div>
            </section>
          </div>

          {rep && (
            <>
              <h3>Results</h3>
              <div className="probe-row">
                <span className="hint">
                  pooled σ <b>{f(rep.pooledStd)} mm</b> · {rep.spotCount} spot{rep.spotCount === 1 ? '' : 's'} · {rep.attemptCount} attempts
                </span>
                <span className={`hm-stat-value ${GRADE_CLASS[rep.grade]}`}>{rep.grade}</span>
              </div>
              <div className="hm-stats">
                <div className="hm-stat"><span className="hm-stat-label">pooled σ</span><span className="hm-stat-value">{f(rep.pooledStd)} mm</span></div>
                {rep.worstSpot && (
                  <div className="hm-stat"><span className="hm-stat-label">worst range</span><span className="hm-stat-value">{f(rep.worstSpot.range)} mm</span></div>
                )}
              </div>
              <div className="rt-table-wrap">
                <table className="rt-table">
                  <thead>
                    <tr>
                      <th>{runMode === 'cycled' ? 'pass' : '#'}</th>
                      {rep.spots.map((s, i) => (
                        <th key={i} title={`spot ${i + 1}`}>
                          #{i + 1}<br />
                          <span className="rt-coord">{fmtAxis(s.x)}, {fmtAxis(s.y)}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {maxN.map((_, row) => (
                      <tr key={row}>
                        <td className="rt-rowhead">{row + 1}</td>
                        {rep.spots.map((s, i) => {
                          const z = s.values[row];
                          if (z === undefined) return <td key={i} className="rt-empty">·</td>;
                          const t = cellHeat(z, s);
                          return (
                            <td key={i} className="rt-cell" style={{ background: heatColor(t) }}>
                              {z.toFixed(3)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    <tr className="rt-stats-row">
                      <td className="rt-rowhead">mean</td>
                      {rep.spots.map((s, i) => <td key={i} className="rt-statcell">{f(s.mean)}</td>)}
                    </tr>
                    <tr className="rt-stats-row">
                      <td className="rt-rowhead">σ</td>
                      {rep.spots.map((s, i) => <td key={i} className="rt-statcell">{f(s.std)}</td>)}
                    </tr>
                    <tr className="rt-stats-row">
                      <td className="rt-rowhead">range</td>
                      {rep.spots.map((s, i) => <td key={i} className="rt-statcell">{f(s.range)}</td>)}
                    </tr>
                    {rep.spots.some((s) => s.drift != null) && (
                      <tr className="rt-stats-row">
                        <td className="rt-rowhead">drift</td>
                        {rep.spots.map((s, i) => (
                          <td key={i} className="rt-statcell">{s.drift == null ? '—' : `${s.drift >= 0 ? '+' : ''}${f(s.drift)}`}</td>
                        ))}
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="hint">
                Cells heat-tinted per spot (blue = low, red = high within that spot's range).
                σ ≤ 0.005 excellent · ≤ 0.010 good · ≤ 0.020 fair · worse: check probe mount, feed, surface.
              </p>
              <div className="probe-row">
                <button onClick={() => probeStore.clearTest()}>Clear results</button>
              </div>
            </>
          )}
        </div>
        <div className="modal-foot">
          <span className="hint">
            {running ? `probing ${probe.progress?.current ?? 0}/${probe.progress?.total ?? 0}` : `${spots.length * attempts} total probes`}
          </span>
          <span className="spacer" />
          <button onClick={onClose}>Close</button>
          <button
            className="run-btn"
            disabled={!port || running || spots.length === 0 || attempts < 2}
            onClick={startTest}
          >
            {armed ? `Confirm test (${spots.length * attempts})` : 'Run test'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
