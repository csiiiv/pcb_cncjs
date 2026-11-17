// Persistent status footer: machine summary + workflow guide.
// Always-visible answers to "is it connected, where is the tool, what runs now,
// and what should I do next".
import { useMachineState, useProbe, probeStore } from '../cnc/runtime.js';
import { ConnectionState } from '../cnc/connection.js';
import { useViz } from '../visualizer/vizStore.js';
import { useRunnerState } from '../cnc/runnerStore.js';
import { computeNextStep, computeSessionNextStep, openGuidedStage } from '../workflow.js';
import { useSession } from '../workflow/session.js';
import { openGuide } from '../workflow/guide.js';
import { loadedJobMatches } from '../cnc/jobRunner.js';
import { focusWidget } from './focus.js';

const fmt = (n, d = 2) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toFixed(d));
const alarmStates = new Set(['Alarm', 'Door']);
const holdStates = new Set(['Hold']);
const runStates = new Set(['Run']);

export default function StatusFooter() {
  const snap = useMachineState();
  const v = useViz();
  const runner = useRunnerState();
  const probe = useProbe(probeStore); // measured surface → compensation hint
  const session = useSession();

  const portOpen = Boolean(snap.connectedPort);
  const running = runStates.has(snap.activeState);
  const paused = holdStates.has(snap.activeState) && snap.workflowState === 'paused';
  const busy = running || paused || snap.activeState === 'Jog';
  const alarmed = alarmStates.has(snap.activeState);
  const senderReady = Boolean(runner.loaded) && loadedMatchesPreviewSafe(runner.loaded, v.job, snap.connectedPort);
  // Surface measured but never applied → suggest compensation before cutting
  // (file-loaded and CAM jobs carry nominal:true; compensated ones false)
  const measuredCount = probe.vertices.filter((p) => Number.isFinite(Number(p.z))).length;
  const compensationPending = measuredCount >= 3 && !v.compensatedJob && v.job?.nominal !== false;

  // Session-aware when a board session is active (any mode); heuristic flow
  // otherwise (Debug dock without a session).
  const next = session
    ? computeSessionNextStep({ session, workflowState: snap.workflowState, probeRunning: probe.running })
    : computeNextStep({
      serverConnected: snap.server === ConnectionState.CONNECTED,
      port: snap.connectedPort,
      machineBusy: busy,
      jobRunning: snap.workflowState === 'running' || snap.workflowState === 'paused',
      paused,
      hasJob: Boolean(v.job),
      compensationPending,
      senderReady,
      stateLabel: snap.activeState ?? ''
    });

  // sender progress
  const s = snap.sender;
  const progress = s && s.total ? Math.min(100, Math.round((s.sent / s.total) * 100)) : 0;

  return (
    <footer className="status-footer" role="status" aria-label="Machine status">
      {/* Machine state pill */}
      <span
        className={`footer-pill state-${alarmed ? 'alarm' : paused ? 'hold' : running ? 'run' : busy ? 'busy' : portOpen ? 'idle' : 'offline'}`}
        title={alarmed ? 'Machine is in alarm state — unlock required' : snap.activeState ?? 'No controller connected'}
      >
        {snap.activeState ?? (portOpen ? '…' : 'offline')}
        {snap.subState != null && snap.subState !== 0 ? ` ${snap.subState}` : ''}
      </span>

      {/* Connection: port + server */}
      <span className="footer-cell" title="Machine connection">
        <span className="k">port</span>
        <span className={`v ${portOpen ? 'ok' : 'bad'}`}>{snap.connectedPort ?? '—'}</span>
      </span>
      <span className="footer-cell" title="CNCjs server connection">
        <span className="k">srv</span>
        <span className={`v ${snap.server === ConnectionState.CONNECTED ? 'ok' : 'bad'}`}>
          {snap.server === ConnectionState.CONNECTED ? 'on' : snap.server}
        </span>
      </span>

      {/* WPos — primary PCB coordinate display */}
      <span className="footer-cell wpos" title="Work position (G54)">
        <span className="k">WPos</span>
        <span className="v mono">
          X{fmt(snap.wpos?.x)} Y{fmt(snap.wpos?.y)} Z{fmt(snap.wpos?.z)}
        </span>
      </span>

      {/* Spindle: programmed S + realtime override/accessory */}
      <span className="footer-cell" title="Spindle speed / override">
        <span className="k">S</span>
        <span className="v mono">
          {snap.spindleRpm != null ? fmt(snap.spindleRpm, 0) : fmt(snap.spindle, 0)}
          {snap.ov?.[2] && snap.ov[2] !== 100 ? ` (${snap.ov[2]}%)` : ''}
        </span>
        {snap.accessoryState?.includes('S') && <span className="spin-icon" title="Spindle running">◉</span>}
      </span>

      {/* Feed override badge */}
      {snap.ov?.[0] != null && snap.ov[0] !== 100 && (
        <span className="footer-cell" title="Feed override">
          <span className="k">F ov</span>
          <span className="v mono warn">{snap.ov[0]}%</span>
        </span>
      )}

      {/* Job progress */}
      <span className="footer-cell" title="Sender progress">
        <span className="k">job</span>
        <span className="v mono">
          {s && s.total ? `${progress}% (${s.sent}/${s.total})` : '—'}
        </span>
      </span>

      <span className="spacer" />

      {/* Workflow guide — the persistent "what next".
          Neutral while the step's requirements aren't met yet; green once
          the step is done/skipped and we're ready to advance. */}
      {(() => {
        const stageRec = session && next.stage ? session.stages[next.stage] : null;
        const ready = Boolean(stageRec?.done || stageRec?.skipped);
        return (
          <button
            className={`next-step ${ready ? 'ready' : ''}`}
            onClick={() => {
              if (session && next.stage) openGuidedStage(next.stage); // Guided wizard (no-op when not mounted)
              // Debug dock fallback spotlight — skip when the wizard caught it
              if (!document.querySelector('.guided-wizard')) focusWidget(next.widget);
            }}
            title={ready
              ? `${next.label} — done, open the next step`
              : session && next.stage ? 'Open the guided step' : 'Show the widget for this step'}
          >
            <span className="k">{ready ? 'done' : 'next'}</span>
            <span className="v">{next.label}</span>
            <span className="arrow">→</span>
          </button>
        );
      })()}
      {next.stage && (
        <button
          className="next-step-help"
          onClick={() => openGuide(next.stage, { manual: true })}
          title={`What do I do? — ${next.label}`}
          aria-label={`Guide for step: ${next.label}`}
        >?</button>
      )}
    </footer>
  );
}

function loadedMatchesPreviewSafe(loaded, previewJob, port) {
  try {
    return loadedJobMatches(loaded, previewJob, port);
  } catch {
    return false;
  }
}