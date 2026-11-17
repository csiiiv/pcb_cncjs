// Job Runner: execute the loaded toolpath job on the machine (brief §38).
// Safety (brief §40): requires port connected + a loaded job + explicit Start.
// Start is triple-gated: pre-flight checklist → arm → second click within 4s.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMachineState, jobRunner, machineCommands, store } from '../cnc/runtime.js';
import { loadedJobMatches } from '../cnc/jobRunner.js';
import { useViz } from '../visualizer/vizStore.js';
import { useRunnerState, setRunnerState, recordCompletedRun } from '../cnc/runnerStore.js';
import { toast } from '../ui/toast.js';

const OVERRIDE_STEPS = [10, 1, 0, -1, -10];

function OverrideControl({ label, values, current, onStep, onReset, resetLabel = '100%' }) {
  return (
    <div className="ov-control">
      <span className="label">
        {label}
        {current != null && <b className={current === 100 ? '' : 'ov-changed'}> {current}%</b>}
      </span>
      <span className="seg">
        {values.map((v) => (
          <button key={v} onClick={() => onStep(v)} disabled={!onStep} title={v > 0 ? `+${v}%` : v === 0 ? resetLabel : `${v}%`}>
            {v > 0 ? `+${v}` : v === 0 ? '100' : v}
          </button>
        ))}
      </span>
    </div>
  );
}

export default function JobRunnerWidget() {
  const snap = useMachineState();
  const v = useViz();
  const runner = useRunnerState();
  const loaded = runner.loaded;
  const [error, setError] = useState(null);
  const [armed, setArmed] = useState(false);

  const portOpen = Boolean(snap.connectedPort);
  const workflow = snap.workflowState;
  const running = workflow === 'running';
  const paused = workflow === 'paused';
  const busy = running || paused;
  const sender = snap.sender;
  const execLine = snap.execLine;
  const sentLine = sender?.sent ?? 0;
  const loadedMatchesPreview = loadedJobMatches(loaded, v.job, snap.connectedPort);

  // Switching a CAM operation must require loading that operation into the
  // sender; an earlier loaded program must never inherit the new preview.
  // Track PREVIOUS values so a widget remount (dock rearrange) does not
  // falsely clear a loaded job the server-side sender still holds.
  const prevJobKey = useRef(null);
  useEffect(() => {
    const key = `${v.job?.name ?? ''}\u0000${v.job?.text?.length ?? 0}\u0000${snap.connectedPort ?? ''}`;
    if (prevJobKey.current !== null && prevJobKey.current !== key) {
      setRunnerState({ loaded: null });
      setArmed(false);
    }
    prevJobKey.current = key;
  }, [v.job?.text, v.job?.name, snap.connectedPort]);

  // arming timeout
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), 6000);
    return () => clearTimeout(t);
  }, [armed]);

  // record completed runs (workflow returns to idle after running)
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy && workflow === 'idle') {
      recordCompletedRun(loaded?.name);
    }
    wasBusy.current = busy;
  }, [busy, workflow, loaded?.name]);

  const loadJob = async () => {
    try {
      setError(null);
      if (!v.job) throw new Error('no job loaded in the visualizer');
      const job = v.job;
      const port = snap.connectedPort;
      const status = await jobRunner.load(job.name, job.text);
      setRunnerState({ loaded: { name: job.name, text: job.text, port, total: status?.total ?? 0 } });
      toast(`${job.name} loaded into sender (${status?.total ?? 0} lines)`);
    } catch (err) {
      setError(err.message);
    }
  };

  // Pre-flight checklist (brief §40): everything verifiable at arm time.
  // compensationApplied = the preview differs from what the sender holds.
  const compensationApplied = v.compensatedJob != null && v.job?.text === v.compensatedJob.text;
  const preflight = useMemo(() => {
    if (!armed) return [];
    const items = [];
    items.push({ ok: portOpen, label: portOpen ? `Port ${snap.connectedPort} open` : 'Machine port not connected' });
    items.push({ ok: loadedMatchesPreview, label: loadedMatchesPreview ? `Sender holds previewed job (${loaded?.name ?? v.job?.name})` : 'Sender does not hold the previewed job — reload first' });
    if (v.job?.tool) items.push({ ok: true, label: `Expected tool: ${v.job.tool}` });
    items.push({
      ok: !v.compensatedJob || compensationApplied,
      label: !v.compensatedJob
        ? 'No compensation applied (nominal G-code)'
        : compensationApplied
          ? 'Surface compensation applied to the previewed job'
          : 'Compensation was applied but the preview was reverted — reload into sender'
    });
    items.push({ ok: true, label: `WCS: ${snap.modal?.wcs ?? 'G54'} · units: ${snap.modal?.units === 'G20' ? 'inch' : 'mm'}` });
    return items;
  }, [armed, portOpen, loadedMatchesPreview, loaded?.name, v.job?.tool, v.compensatedJob, compensationApplied, snap.connectedPort, snap.modal?.wcs, snap.modal?.units, v.job?.name]);

  const start = () => {
    const current = store.getSnapshot();
    if (!loadedJobMatches(loaded, v.job, current.connectedPort)
        || ['running', 'paused'].includes(current.workflowState)) return;
    if (!armed) {
      if (preflight.some((i) => !i.ok)) {
        setError('Resolve pre-flight warnings before starting (see checklist).');
        return;
      }
      setArmed(true); // safety: pre-flight shown, second click within 6s starts
      return;
    }
    setArmed(false);
    setError(null);
    try { jobRunner.start(); } catch (err) { setError(err.message); }
  };

  const progress = sender && sender.total
    ? Math.min(100, Math.round((sender.sent / sender.total) * 100))
    : 0;

  const ov = snap.ov; // [feed, rapid, spindle] percent
  const canOverride = portOpen && busy;

  const fmtTime = (ms) => {
    if (!ms || ms < 0) return '—';
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  return (
    <section className="widget job-runner">
      <div className="widget-head">
        <h2>Job Runner</h2>
        {loaded && (
          <span className="hint">
            {loaded.name} · {loaded.total} lines
            {runner.completed.some((r) => r.name === loaded.name) ? ' · run this session' : ''}
          </span>
        )}
        <span className="spacer" />
        {v.job && !busy && (
          <button onClick={loadJob}>
            {loaded ? (loadedMatchesPreview ? 'Reload into sender' : 'Reload changed preview') : 'Load into sender'}
          </button>
        )}
      </div>

      {!v.job && <div className="hint">load G-code in the visualizer first</div>}

      {error && <div className="error">{error}</div>}

      {/* Preview-divergence banner: the #1 silent failure. When the sender
          holds something other than the previewed text, Start stays dead —
          narrate WHY and put the fix next to it. */}
      {v.job && !busy && loaded && !loadedMatchesPreview && (
        <div className="preflight warn">
          <b>Preview changed since loading.</b> The sender still holds an earlier version of this job.
          <button className="inline" onClick={loadJob}>Reload into sender</button>
        </div>
      )}
      {v.job && !busy && !loaded && (
        <div className="preflight info">
          Previewed job is not loaded into the sender yet — load it to enable Start.
        </div>
      )}

      {v.job && (
        <>
          <div className="run-controls">
            {!busy ? (
              <button
                className={`run-btn ${armed ? 'armed' : ''}`}
                disabled={!portOpen || !loadedMatchesPreview}
                onClick={start}
                title={armed ? 'click again to START' : 'load job, then click twice to start'}
              >
                {armed ? 'CONFIRM START' : 'Start'}
              </button>
            ) : paused ? (
              <button className="run-btn" onClick={() => jobRunner.resume()}>Resume</button>
            ) : (
              <button className="run-btn" onClick={() => jobRunner.pause()}>Pause</button>
            )}
            <button disabled={!busy} onClick={() => jobRunner.stop()}>Stop</button>
            <button
              disabled={!busy}
              onClick={() => jobRunner.stopForce()}
              title="hold + soft-reset (position may be lost)"
            >
              Force Stop
            </button>
          </div>

          {armed && (
            <ul className="preflight-list" aria-label="Pre-flight checklist">
              {preflight.map((item) => (
                <li key={item.label} className={item.ok ? 'ok' : 'bad'}>
                  <span>{item.ok ? '✓' : '!'}</span> {item.label}
                </li>
              ))}
            </ul>
          )}

          {!portOpen && <div className="hint">machine port not connected — controls disabled</div>}

          {(busy || progress > 0) && (
            <div className="run-progress">
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <div className="progress-stats">
                <span>{progress}%</span>
                <span className="hint">
                  line {sender?.sent ?? 0}/{sender?.total ?? loaded?.total ?? 0}
                </span>
                {execLine != null && (
                  <span className="hint">
                    executing ln {execLine}
                    {sentLine > execLine ? ` (+${sentLine - execLine} buffered)` : ''}
                  </span>
                )}
                <span className="hint">elapsed {fmtTime(sender?.elapsedTime)}</span>
                <span className="hint">remaining {fmtTime(sender?.remainingTime)}</span>
              </div>
            </div>
          )}

          {(busy || (ov && ov.some((x) => x !== 100))) && (
            <div className="ov-group" role="group" aria-label="Realtime overrides">
              <OverrideControl
                label="Feed"
                values={OVERRIDE_STEPS}
                current={ov?.[0]}
                onStep={canOverride ? (s) => machineCommands.feedOverride(s) : null}
              />
              <OverrideControl
                label="Rapid"
                values={[100, 50, 25]}
                current={ov?.[1]}
                onStep={canOverride ? (p) => machineCommands.rapidOverride(p) : null}
              />
              <OverrideControl
                label="Spindle"
                values={OVERRIDE_STEPS}
                current={ov?.[2]}
                onStep={canOverride ? (s) => machineCommands.spindleOverride(s) : null}
              />
            </div>
          )}

          {workflow && (
            <div className="hint" style={{ marginTop: 6 }}>
              workflow: <b>{workflow}</b>
            </div>
          )}
        </>
      )}
    </section>
  );
}
