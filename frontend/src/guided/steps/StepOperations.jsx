// Guided step 8 — run operations. Distilled Job Runner: per-operation rows
// with tool-change sub-steps, sender load, pre-flight, arm/start. Reuses
// jobRunner + runner store; completion reconciled from workflow-state edges.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMachineState, jobRunner, machineCommands } from '../../cnc/runtime.js';
import { loadedJobMatches } from '../../cnc/jobRunner.js';
import { useViz } from '../../visualizer/vizStore.js';
import { useRunnerState, setRunnerState } from '../../cnc/runnerStore.js';
import { useSession, setToolMounted, zFreshSinceToolChange } from '../../workflow/session.js';
import { loadCamOperation } from '../../cam/preview.js';
import { getCam } from '../../cam/store.js';
import { showNominalPreview, showCompensatedPreview } from '../../visualizer/jobCompensation.js';
import { toast } from '../../ui/toast.js';

export default function StepOperations() {
  const snap = useMachineState();
  const v = useViz();
  const runner = useRunnerState();
  const session = useSession();
  const loaded = runner.loaded;
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState(null);

  const portOpen = Boolean(snap.connectedPort);
  const workflow = snap.workflowState;
  const running = workflow === 'running';
  const paused = workflow === 'paused';
  const busy = running || paused;
  const sender = snap.sender;
  const loadedMatchesPreview = loadedJobMatches(loaded, v.job, snap.connectedPort);
  const ops = session?.operations || [];
  const opFreshZ = zFreshSinceToolChange(session);

  // arming timeout
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), 6000);
    return () => clearTimeout(t);
  }, [armed]);

  // preview switch clears the loaded sender state (never inherit)
  const prevJobKey = useRef(null);
  useEffect(() => {
    const key = `${v.job?.name ?? ''}\u0000${v.job?.text?.length ?? 0}\u0000${snap.connectedPort ?? ''}`;
    if (prevJobKey.current !== null && prevJobKey.current !== key) {
      setRunnerState({ loaded: null });
      setArmed(false);
    }
    prevJobKey.current = key;
  }, [v.job?.text, v.job?.name, snap.connectedPort]);

  const showing = (op) => v.job?.operationId === op.id;
  const showingCompensated = (op) => showing(op) && v.compensatedJob != null && v.job?.text === v.compensatedJob.text;
  const showingRaw = (op) => showing(op) && !showingCompensated(op);
  const hasCompensatedCopy = (op) => v.compensatedJob?.operationId === op.id && v.nominalJob?.operationId === op.id;

  const previewRaw = (op) => {
    if (busy) return;
    setError(null);
    try {
      // Same operation already has both copies — switch the preview, don't
      // reload CAM output (that would discard the compensated toolpath).
      if (hasCompensatedCopy(op)) {
        showNominalPreview();
        toast(`${op.name}: previewing raw G-code`);
        return;
      }
      const displaced = v.compensatedJob?.operationId;
      const camOp = getCam().result?.operations.find((o) => o.id === op.id);
      if (!camOp) throw new Error('CAM result for this operation is gone — regenerate');
      loadCamOperation(camOp);
      if (displaced && displaced !== op.id) {
        toast(`Previewing raw ${op.name}. Compensated copy of the previous operation was cleared.`, 'warn');
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const previewCompensated = (op) => {
    if (busy) return;
    setError(null);
    try {
      if (!hasCompensatedCopy(op)) throw new Error('No compensated toolpath for this operation — apply compensation while it is previewed');
      showCompensatedPreview();
      toast(`${op.name}: previewing compensated G-code`);
    } catch (err) {
      setError(err.message);
    }
  };

  const loadSender = async () => {
    try {
      setError(null);
      if (!v.job) throw new Error('no job previewed — pick an operation above');
      const status = await jobRunner.load(v.job.name, v.job.text);
      setRunnerState({ loaded: { name: v.job.name, text: v.job.text, port: snap.connectedPort, total: status?.total ?? 0 } });
      toast(`${v.job.name} loaded into sender (${status?.total ?? 0} lines)`);
    } catch (err) {
      setError(err.message);
    }
  };

  const compensationApplied = v.compensatedJob != null && v.job?.text === v.compensatedJob.text;
  const preflight = useMemo(() => {
    if (!armed) return [];
    const items = [];
    items.push({ ok: portOpen, label: portOpen ? `Port ${snap.connectedPort} open` : 'Machine port not connected' });
    items.push({ ok: loadedMatchesPreview, label: loadedMatchesPreview ? `Sender holds previewed job (${loaded?.name ?? v.job?.name})` : 'Load the previewed job into the sender first' });
    items.push({ ok: opFreshZ, label: opFreshZ ? 'Z re-probed since tool change' : 'Z stale — re-probe Z after the tool change' });
    if (v.job?.tool) items.push({ ok: true, label: `Expected tool: ${v.job.tool}` });
    items.push({
      ok: !v.compensatedJob || compensationApplied,
      label: !v.compensatedJob
        ? 'No compensation applied (nominal G-code)'
        : compensationApplied ? 'Surface compensation applied to the previewed job' : 'Compensation applied but preview reverted — reload'
    });
    items.push({ ok: true, label: `WCS ${snap.modal?.wcs ?? 'G54'} · ${snap.modal?.units === 'G20' ? 'inch' : 'mm'}` });
    return items;
  }, [armed, portOpen, loadedMatchesPreview, loaded?.name, v.job?.name, v.job?.tool, v.compensatedJob, compensationApplied, snap.connectedPort, snap.modal?.wcs, snap.modal?.units, opFreshZ]);

  const start = () => {
    if (busy) return;
    if (!loadedMatchesPreview) { setError('load the previewed job into the sender first'); return; }
    if (!armed) {
      if (preflight.some((i) => !i.ok)) { setError('resolve pre-flight warnings first'); return; }
      setArmed(true);
      return;
    }
    setArmed(false);
    setError(null);
    try { jobRunner.start(); } catch (err) { setError(err.message); }
  };

  const changeTool = () => {
    const desc = prompt('Tool being mounted (e.g. 0.8 mm end mill):', session?.toolMounted?.description || '');
    if (desc === null) return;
    setToolMounted(desc.trim() || null);
    if (desc.trim()) toast('Tool recorded — re-probe Z before cutting', 'warn');
  };

  const progress = sender && sender.total ? Math.min(100, Math.round((sender.sent / sender.total) * 100)) : 0;

  return (
    <div className="gw-step">
      {/* operation rows */}
      <div className="gw-ops">
        {ops.length === 0 && <p className="hint">No operations — generate toolpaths first.</p>}
        {ops.map((op) => {
          const active = session.activeOperationId === op.id;
          return (
            <div key={op.id} className={`gw-op op-${op.status} ${active ? 'active' : ''}`}>
              <div className="gw-op-main">
                <b>{op.name}</b>
                <div className="hint">{op.tool} · Z {op.depth} mm</div>
              </div>
              <span className={`tag ${op.status === 'done' || op.status === 'skipped' ? 'ok' : op.status === 'failed' ? 'bad' : ''}`}>
                {op.status === 'running' ? '▶ running' : op.status}
              </span>
              {showingRaw(op) && <span className="tag">raw</span>}
              {showingCompensated(op) && <span className="tag ok">compensated</span>}
              <span className="spacer" />
              {hasCompensatedCopy(op) ? (
                <>
                  <button
                    disabled={busy || showingRaw(op)}
                    onClick={() => previewRaw(op)}
                    title="Preview the generated G-code. The compensated copy stays available."
                  >{showingRaw(op) ? '✓ Raw' : 'Raw'}</button>
                  <button
                    className={showingCompensated(op) ? '' : 'primary'}
                    disabled={busy || showingCompensated(op)}
                    onClick={() => previewCompensated(op)}
                    title="Preview the surface-compensated G-code for this operation"
                  >{showingCompensated(op) ? '✓ Compensated' : 'Compensated'}</button>
                </>
              ) : (
                <button disabled={busy || showingRaw(op)} onClick={() => previewRaw(op)}
                  title="load this operation's generated G-code into the visualizer">
                  {showingRaw(op) ? '✓ Raw' : 'Preview'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="gw-actions gw-toolrow">
        <button onClick={changeTool}>Record tool…</button>
        <span className="hint">
          {session?.toolMounted ? `mounted: ${session.toolMounted.description}` : 'no tool recorded'}
          {!opFreshZ && session?.toolMounted && ' · Z stale — re-probe'}
        </span>
      </div>

      {/* sender */}
      <div className="gw-sender">
        <div className="gw-sender-head">
          <b>Sender</b>
          <span className="hint">{loaded ? `${loaded.name} · ${loaded.total} lines` : 'empty'}</span>
          <span className="spacer" />
          {v.job && !busy && (
            <button onClick={loadSender}>
              {loaded ? (loadedMatchesPreview ? 'Reload' : 'Reload changed preview') : 'Load into sender'}
            </button>
          )}
        </div>

        {v.job && !busy && loaded && !loadedMatchesPreview && (
          <div className="preflight warn"><b>Preview changed.</b> The sender holds an older version.</div>
        )}

        <div className="run-controls">
          {!busy ? (
            <button className={`run-btn ${armed ? 'armed' : ''}`} disabled={!portOpen || !loadedMatchesPreview} onClick={start}>
              {armed ? 'CONFIRM START' : 'Start'}
            </button>
          ) : paused ? (
            <button className="run-btn" onClick={() => jobRunner.resume()}>Resume</button>
          ) : (
            <button className="run-btn" onClick={() => jobRunner.pause()}>Pause</button>
          )}
          <button disabled={!busy} onClick={() => jobRunner.stop()}>Stop</button>
          <button disabled={!busy} onClick={() => jobRunner.stopForce()} title="hold + soft-reset">Force stop</button>
        </div>

        {armed && (
          <ul className="preflight-list" aria-label="Pre-flight checklist">
            {preflight.map((item) => (
              <li key={item.label} className={item.ok ? 'ok' : 'bad'}><span>{item.ok ? '✓' : '!'}</span> {item.label}</li>
            ))}
          </ul>
        )}

        {(busy || progress > 0) && (
          <div className="run-progress">
            <div className="progress-bar"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
            <div className="progress-stats">
              <span>{progress}%</span>
              <span className="hint">line {sender?.sent ?? 0}/{sender?.total ?? 0}</span>
              {snap.execLine != null && <span className="hint">exec ln {snap.execLine}</span>}
            </div>
          </div>
        )}

        {busy && (
          <div className="gw-actions">
            <button onClick={() => machineCommands.feedOverride(-10)}>F −10%</button>
            <button onClick={() => machineCommands.feedOverride(0)}>F 100</button>
            <button onClick={() => machineCommands.feedOverride(10)}>F +10%</button>
          </div>
        )}
      </div>

      {error && <div className="error">{error}</div>}
    </div>
  );
}
