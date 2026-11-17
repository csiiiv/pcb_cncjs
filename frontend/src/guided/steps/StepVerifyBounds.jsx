// Guided stage — verify the work envelope before probing. Sends a perimeter
// tour of the job bounds + margin at a chosen clearance Z so the operator can
// watch the tool stay on copper and clear of clamps — exactly where the
// surface probe lattice will travel. Completion is marked by this step when
// the tour program finishes (busy→idle), same pattern as Park.
import { useEffect, useMemo, useRef, useState } from 'react';
import { machineCommands, useMachineState } from '../../cnc/runtime.js';
import { useViz } from '../../visualizer/vizStore.js';
import { useDefaultState } from '../../settings/store.js';
import { setStageDone, skipStage } from '../../workflow/session.js';
import { boundsTourProgram } from '../boundsTour.js';
import { toast } from '../../ui/toast.js';
import NumField from '../../ui/NumField.jsx';

const fmt = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toFixed(1));

export default function StepVerifyBounds({ done, session, onNavigate }) {
  const snap = useMachineState();
  const v = useViz();
  const [tourZ, setTourZ] = useDefaultState('autolevel', 'clearanceZ');
  const [margin, setMargin] = useDefaultState('autolevel', 'margin');
  const [error, setError] = useState(null);
  const [touring, setTouring] = useState(false);

  const jobBounds = v.job?.bounds;
  const box = useMemo(() => {
    if (!jobBounds || !Number.isFinite(jobBounds.min.x)) return null;
    return {
      minX: Math.floor(jobBounds.min.x - margin),
      maxX: Math.ceil(jobBounds.max.x + margin),
      minY: Math.floor(jobBounds.min.y - margin),
      maxY: Math.ceil(jobBounds.max.y + margin)
    };
  }, [jobBounds, margin]);

  const program = useMemo(() => (box ? boundsTourProgram(box, tourZ) : null), [box, tourZ]);

  // Draw the tour rectangle in the 3D view while this step is open (same
  // overlay machinery as the probe tour; cleared on unmount).
  useEffect(() => {
    const scene = v.scene;
    if (!scene?.setProbeOrder) return undefined;
    if (!box) return undefined;
    scene.setProbeOrder([
      { x: box.minX, y: box.minY },
      { x: box.maxX, y: box.minY },
      { x: box.maxX, y: box.maxY },
      { x: box.minX, y: box.maxY },
      { x: box.minX, y: box.minY }
    ]);
    return () => scene.setProbeOrder([]);
  }, [box, v.scene]);

  const busy = ['running', 'paused'].includes(snap.workflowState)
    || snap.activeState === 'Run'
    || snap.activeState === 'Hold'
    || snap.activeState === 'Jog';
  const alarm = snap.activeState === 'Alarm' || snap.activeState === 'Door';
  const canSend = Boolean(snap.connectedPort) && !busy && !alarm && box != null;

  const runTour = () => {
    setError(null);
    if (!box) { setError('no job preview loaded — preview an operation first (bounds are unknown)'); return; }
    if (!Number.isFinite(tourZ) || tourZ <= 0) { setError('tour Z must be above the board surface (positive work Z)'); return; }
    try {
      machineCommands.runGcode(program);
      sawBusy.current = false;
      setTouring(true);
      toast('Envelope tour running — watch the tool stay on copper', 'info');
    } catch (err) {
      setError(err.message);
    }
  };

  // Tour completion: GRBL enters Run while the tour streams, then settles
  // back to Idle. Direct 'gcode' commands bypass the sender feeder, so
  // workflowState never flips — activeState is the reliable signal. Wait for
  // at least one busy sample before trusting idle (status polls lag dispatch).
  const sawBusy = useRef(false);
  useEffect(() => {
    if (!touring) return;
    if (busy) {
      sawBusy.current = true;
      return;
    }
    if (alarm) {
      // faulted mid-tour: drop the touring flag without claiming success
      setTouring(false);
      sawBusy.current = false;
      setError('Tour interrupted — unlock, then run it again to complete the stage');
      return;
    }
    if (!sawBusy.current) return; // not observed running yet
    setTouring(false);
    setStageDone('verifyBounds', true, { z: tourZ, operationId: v.job?.operationId ?? null });
    toast('Envelope verified — bounds recorded');
  }, [touring, busy, alarm, tourZ, v.job?.operationId]);

  // safety: a stuck "touring" flag (status lost) clears when the operator leaves
  useEffect(() => () => { sawBusy.current = false; }, []);

  // Fast tours can slip between status polls (never observed Run) — after a
  // grace period with no busy sample, stop waiting and say so honestly
  // instead of leaving a dead "Touring…" state or claiming success.
  useEffect(() => {
    if (!touring || sawBusy.current) return undefined;
    const t = setTimeout(() => {
      if (!sawBusy.current) {
        setTouring(false);
        setError('No motion observed — the tour may have finished between status reports. Run it again (watch the tool this time) to record the stage.');
      }
    }, 4000);
    return () => clearTimeout(t);
  }, [touring]);

  const stopTour = () => {
    try { machineCommands.jogCancel(); } catch { /* no jog in flight */ }
    try { machineCommands.reset(); } catch { /* already down */ }
    setTouring(false);
    setError('Tour stopped — resolve and run it again to complete the stage');
  };

  const skipped = Boolean(session?.stages?.verifyBounds?.skipped);

  // Every blocking reason, prominently (a disabled button must explain itself).
  const blockers = [];
  if (!snap.connectedPort) blockers.push({ label: 'Machine port is closed — connect first', go: 'connected' });
  if (box == null) blockers.push({ label: 'No job preview loaded — preview an operation first', go: 'toolpath' });
  if (alarm) blockers.push({ label: `GRBL is in ${snap.activeState} — unlock ($X) before touring`, unlock: true });
  if (busy && !touring) blockers.push({ label: `Machine is busy (${snap.activeState ?? snap.workflowState}) — wait for it to settle` });

  return (
    <div className="gw-step">
      <p className="gw-status">
        <span className={`tag ${done ? 'ok' : ''}`}>{done ? 'verified' : 'not verified'}</span>
        {snap.activeState && <span className={`tag ${alarm ? 'alarm' : ''}`}>{snap.activeState}</span>}
        {skipped && <span className="tag warn">skipped</span>}
      </p>

      <ol className="guide-steps">
        <li>Set the tour height above the board, clamps and fixtures.</li>
        <li>Run the tour. The tool traces the job bounds + margin — the exact extent the surface probe will cover.</li>
        <li>Watch every edge: on copper, clear of clamps. Especially for jobs near a board edge.</li>
        <li>If it strays off, re-zero XY or re-mount the board, then tour again.</li>
      </ol>

      {box ? (
        <p className="hint">
          Tour box: X {fmt(box.minX)}…{fmt(box.maxX)} · Y {fmt(box.minY)}…{fmt(box.maxY)} mm
          (job bounds + {margin} mm margin) at Z {fmt(tourZ)} mm.
        </p>
      ) : (
        <p className="hint warn">No job preview loaded — preview an operation in the Select-toolpath step first.</p>
      )}

      <div className="probe-fields cols-2">
        <NumField label="Tour Z (mm)" value={tourZ} onChange={setTourZ} />
        <NumField label="Margin (mm)" value={margin} onChange={(m) => setMargin(Math.max(0, m))} />
      </div>

      {program && (
        <details className="gw-tour-preview">
          <summary>Program that will be sent</summary>
          <pre aria-label="Tour G-code">{program.join('\n')}</pre>
        </details>
      )}

      {blockers.length > 0 && !touring && (
        <div className="preflight warn">
          {blockers.map((b, i) => (
            <div key={i} className="gw-block-row">
              <span>{b.label}</span>
              {b.go && onNavigate && <button className="inline" onClick={() => onNavigate(b.go)}>Go to step →</button>}
              {b.unlock && <button className="inline" disabled={!snap.connectedPort}
                onClick={() => { try { machineCommands.unlock(); } catch { /* already unlocked */ } }}>Unlock ($X)</button>}
            </div>
          ))}
        </div>
      )}

      <div className="gw-actions">
        <button className="primary" disabled={!canSend} onClick={runTour}
          title={canSend ? 'trace the tour box at tour Z' : blockers[0]?.label || 'unavailable'}>
          {touring ? 'Touring…' : done ? 'Tour again' : 'Run envelope tour'}
        </button>
        {touring && <button onClick={stopTour}>Stop</button>}
      </div>

      {done && !touring && <p className="hint">Envelope verified — the probe lattice stays inside the toured box.</p>}

      {!done && !touring && (
        <button
          className="gw-skip-btn"
          disabled={!session}
          onClick={() => { skipStage('verifyBounds', 'operator skipped'); toast('Bounds check skipped — recorded', 'warn'); }}
          title="Record an explicit skip decision"
        >Skip — bounds assumed good</button>
      )}

      {error && <div className="error">{error}</div>}
    </div>
  );
}
