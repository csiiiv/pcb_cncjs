// Job Runner: execute the loaded toolpath job on the machine (brief §38).
// Safety (brief §40): requires port connected + a loaded job + explicit Start.
// Start is double-gated: first click arms, second click within 4s runs.
import { useEffect, useState } from 'react';
import { useMachineState, jobRunner } from '../cnc/runtime.js';
import { useViz, setViz } from '../visualizer/vizStore.js';

export default function JobRunnerWidget() {
  const snap = useMachineState();
  const v = useViz();
  const [loaded, setLoaded] = useState(null); // { name, total }
  const [error, setError] = useState(null);
  const [armed, setArmed] = useState(false);

  const portOpen = Boolean(snap.connectedPort);
  const workflow = snap.workflowState;
  const running = workflow === 'running';
  const paused = workflow === 'paused';
  const busy = running || paused;
  const sender = snap.sender;

  // arming timeout
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  const loadJob = async () => {
    try {
      setError(null);
      if (!v.job) throw new Error('no job loaded in the visualizer');
      const status = await jobRunner.load(v.job.name, v.job.text);
      setLoaded({ name: v.job.name, total: status?.total ?? 0 });
    } catch (err) {
      setError(err.message);
    }
  };

  const start = () => {
    if (!armed) {
      setArmed(true); // safety: second click within 4s actually starts
      return;
    }
    setArmed(false);
    setError(null);
    try { jobRunner.start(); } catch (err) { setError(err.message); }
  };

  const progress = sender && sender.total
    ? Math.min(100, Math.round((sender.sent / sender.total) * 100))
    : 0;

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
          </span>
        )}
        <span className="spacer" />
        {v.job && !busy && (
          <button onClick={loadJob}>{loaded ? 'Reload into sender' : 'Load into sender'}</button>
        )}
      </div>

      {!v.job && <div className="hint">load G-code in the visualizer first</div>}

      {error && <div className="error">{error}</div>}

      {v.job && (
        <>
          <div className="run-controls">
            {!busy ? (
              <button
                className={`run-btn ${armed ? 'armed' : ''}`}
                disabled={!portOpen || !loaded}
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
                <span className="hint">elapsed {fmtTime(sender?.elapsedTime)}</span>
                <span className="hint">remaining {fmtTime(sender?.remainingTime)}</span>
              </div>
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
