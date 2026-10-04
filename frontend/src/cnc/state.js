// Derived machine-state helpers over the CNCjs event stream (Phase 1: read-only).
import { ConnectionState } from './connection.js';

export const GRBL_ACTIVE_STATES = [
  'Idle', 'Run', 'Hold', 'Jog', 'Alarm', 'Door', 'Check', 'Home', 'Sleep'
];

const initialSnapshot = () => ({
  // CNCjs server connection
  server: ConnectionState.DISCONNECTED,
  serverError: null,
  loadedControllers: [],
  // Serial / GRBL connection
  ports: [],
  connectedPort: null,
  controllerType: null,
  serialError: null,
  // GRBL state (from controller:state)
  activeState: null,
  subState: null,
  wpos: null, // { x, y, z } strings — work position, PRIMARY for PCB work
  mpos: null, // { x, y, z } strings — machine position, diagnostic only
  wco: null,
  pinState: null,
  modal: null, // { motion, wcs, plane, distance, units, ... }
  feedrate: null,
  spindle: null,
  // Workflow
  workflowState: null,
  // Sender (job execution)
  sender: null, // { name, total, sent, received, startTime, elapsedTime, remainingTime, ... }
  // True execution line: sender.received (GRBL-acked). Falls back to sent.
  execLine: null,
  // Job g-code lines (for the simulated console feed + viewer fallback)
  jobGcodeLines: [],
  // Raw console lines (serialport:read/write), newest last
  consoleLines: []
});

const MAX_CONSOLE_LINES = 200;

export function createMachineStateStore() {
  let snapshot = initialSnapshot();
  const listeners = new Set();

  const commit = (patch) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((l) => l(snapshot));
  };

  const pushConsole = (line) => {
    const lines = [...snapshot.consoleLines, line];
    if (lines.length > MAX_CONSOLE_LINES) lines.splice(0, lines.length - MAX_CONSOLE_LINES);
    commit({ consoleLines: lines });
  };

  // Interpolated job-line console feed. The server's sender bypasses
  // serialport:write for job lines AND only emits sender:status on state
  // change (250ms poll) — a 1s job yields ~2 events total. To make job
  // progress visible in the console at human speed, we simulate per-line
  // output between the coarse sender:status updates we do receive.
  let jobFeed = null; // { from, to, t0, durationMs, total }
  let feedTimer = null;

  const startJobFeed = (fromLine, toLine, elapsedRef) => {
    stopJobFeed();
    if (toLine <= fromLine) return;
    const duration = Math.max(500, (toLine - fromLine) * 120); // ~120ms/line pacing
    jobFeed = { from: fromLine, to: toLine, t0: Date.now(), durationMs: duration };
    const jobLines = snapshot.jobGcodeLines || [];
    const tick = () => {
      if (!jobFeed) return;
      const k = Math.min(1, (Date.now() - jobFeed.t0) / jobFeed.durationMs);
      const target = Math.floor(jobFeed.from + k * (jobFeed.to - jobFeed.from));
      while (jobFeed.current < target && jobFeed.current < jobFeed.to) {
        jobFeed.current++;
        const text = jobLines[jobFeed.current - 1];
        if (text !== undefined && text.trim()) {
          pushConsole({ dir: 'job', text: text.trim() });
        }
      }
      if (k < 1) feedTimer = setTimeout(tick, 100);
    };
    jobFeed.current = fromLine;
    feedTimer = setTimeout(tick, 100);
  };

  const stopJobFeed = () => {
    if (feedTimer) clearTimeout(feedTimer);
    feedTimer = null;
    jobFeed = null;
  };

  const store = {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** Provide the job's g-code lines (called when a job is loaded into the sender). */
    setJobGcode(lines) {
      commit({ jobGcodeLines: lines || [] });
    },

    clearConsole() {
      stopJobFeed();
      commit({ consoleLines: [] });
    },

    // Wire a CNCConnection's events into this store.
    bind(connection) {
      connection.on('state', (state) => {
        const patch = { server: state };
        if (state === ConnectionState.DISCONNECTED) {
          // Server gone: serial link is gone too, but keep last-known GRBL data dimmed?
          // Phase 1 choice: clear the live link fields.
          patch.connectedPort = null;
          patch.serialError = null;
        }
        if (state !== ConnectionState.CONNECTING) patch.serverError = null;
        commit(patch);
      });

      connection.on('error', (err) => commit({ serverError: err?.message || String(err) }));

      connection.on('startup', ({ loadedControllers }) =>
        commit({ loadedControllers: loadedControllers || [] })
      );

      connection.on('serialport:list', (ports) => commit({ ports: ports || [] }));

      connection.on('serialport:open', ({ port, baudrate, controllerType }) =>
        commit({ connectedPort: port, controllerType, serialError: null })
      );

      connection.on('serialport:close', ({ port }) => {
        if (snapshot.connectedPort === port) {
          commit({ connectedPort: null, controllerType: null, activeState: null, workflowState: null });
        }
      });

      connection.on('serialport:error', (err) =>
        commit({ serialError: err?.message || String(err) })
      );

      connection.on('controller:state', (controller, state) => {
        if (controller !== 'Grbl') return; // Phase 1 targets GRBL only
        const s = state?.status || {};
        const p = state?.parserstate || {};
        commit({
          activeState: s.activeState ?? null,
          subState: s.subState ?? null,
          wpos: s.wpos || null,
          mpos: s.mpos || null,
          wco: s.wco || null,
          pinState: s.pinState || null,
          modal: p.modal || null,
          feedrate: p.feedrate ?? null,
          spindle: p.spindle ?? null
        });
      });

      connection.on('workflow:state', (workflowState) => {
        if (workflowState === 'idle') stopJobFeed();
        commit({ workflowState });
      });

      connection.on('sender:status', (sender) => {
        const prev = snapshot.sender;
        // received = lines GRBL has ACKed → the command currently being executed.
        // sent = lines streamed into GRBL's planner buffer (leads the cutter).
        commit({ sender: sender || null, execLine: sender?.received ?? null });
        // simulated per-line console feed between coarse status updates
        if (sender && prev && sender.sent > (prev.received ?? 0) && sender.total > 0) {
          startJobFeed(prev.received ?? 0, sender.sent);
        }
      });

      connection.on('serialport:read', (line) => pushConsole({ dir: 'in', text: String(line) }));
      connection.on('serialport:write', (data) =>
        pushConsole({ dir: 'out', text: String(data).replace(/\n$/, '') }));
    }
  };

  return store;
}

// --- formatting helpers ---

export function fmtAxis(value) {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(3) : String(value);
}

export function stateColor(activeState) {
  switch (activeState) {
    case 'Idle': return 'ok';
    case 'Run': case 'Jog': return 'busy';
    case 'Hold': case 'Door': return 'warn';
    case 'Alarm': return 'alarm';
    case 'Check': case 'Home': case 'Sleep': return 'info';
    default: return 'unknown';
  }
}
