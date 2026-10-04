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
  // True execution line: real (ln=N) ack echoes; sender.received as fallback.
  execLine: null,
  // Raw console lines (serialport:read/write), newest last — ring-buffered
  consoleLines: []
});

const MAX_CONSOLE_LINES = 1000; // user-facing cap; old entries trimmed as new arrive
const CONSOLE_FLUSH_MS = 50;    // batch commits: ≤20 renders/s under ack storms

export function createMachineStateStore() {
  let snapshot = initialSnapshot();
  const listeners = new Set();

  const commit = (patch) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((l) => l(snapshot));
  };

  // Batched console push: real events can arrive in ack storms (100+/s during
  // runs); committing per-line would re-render the whole tree per event.
  // Buffer + flush on a 50ms cadence instead, trimming to the ring cap.
  let consolePending = [];
  let consoleFlushTimer = null;

  const flushConsole = () => {
    consoleFlushTimer = null;
    if (!consolePending.length) return;
    const lines = [...snapshot.consoleLines, ...consolePending];
    if (lines.length > MAX_CONSOLE_LINES) lines.splice(0, lines.length - MAX_CONSOLE_LINES);
    consolePending = [];
    commit({ consoleLines: lines });
  };

  const pushConsole = (entry) => {
    consolePending.push(entry);
    if (!consoleFlushTimer) {
      consoleFlushTimer = setTimeout(flushConsole, CONSOLE_FLUSH_MS);
    }
  };

  // Job-line console feed comes EXCLUSIVELY from real ack echoes
  // "> <line> (ln=N)" emitted by the fork's GrblController patch. The earlier
  // interpolated feed duplicated lines whenever coarse sender:status updates
  // raced the real acks — deleted in favor of real data only.

  const store = {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    clearConsole() {
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

      connection.on('workflow:state', (workflowState) => commit({ workflowState }));

      connection.on('sender:status', (sender) => {
        // received = lines GRBL has ACKed → the command currently being executed.
        // sent = lines streamed into GRBL's planner buffer (leads the cutter).
        // execLine's primary source is the real per-ack (ln=N) echoes; this is
        // the coarse fallback between echoes (and for non-fork servers).
        if (snapshot.execLine == null || (sender?.received ?? 0) > snapshot.execLine) {
          commit({ sender: sender || null, execLine: sender?.received ?? null });
        } else {
          commit({ sender: sender || null });
        }
      });

      connection.on('serialport:read', (line) => {
        const text = String(line);
        pushConsole({ dir: 'in', text });
        // Real per-line ack from the fork patch: "> G1 X10 (ln=47)" = GRBL
        // finished line 47. Real data exclusively drives execLine + console.
        const m = /^> .+\(ln=(\d+)\)$/.exec(text);
        if (m) {
          commit({ execLine: Number(m[1]) });
        }
      });
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
