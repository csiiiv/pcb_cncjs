// Derived machine-state helpers over the CNCjs event stream (Phase 1: read-only).
import { ConnectionState } from './connection.js';
import { connectionErrorMessage } from './errors.js';

export const GRBL_ACTIVE_STATES = [
  'Idle', 'Run', 'Hold', 'Jog', 'Alarm', 'Door', 'Check', 'Home', 'Sleep'
];

const initialSnapshot = () => ({
  // CNCjs server connection
  server: ConnectionState.DISCONNECTED,
  serverError: null,
  loadedControllers: [],
  // Firmware version (from controller:settings, GrblLineParserResultStartup)
  firmware: null,
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
  spindleRpm: null, // realtime FS report; spindle above is programmed S
  accessoryState: null,
  ov: null, // [feed, rapid, spindle] override percentages from Ov: report
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

export function createMachineStateStore() {
  let snapshot = initialSnapshot();
  const listeners = new Set();

  const commit = (patch) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((l) => l(snapshot));
  };

  // Coalesce a burst of acks into ONE commit on the next animation frame.
  // Ack lines are not delayed by the server; painting per-ack would re-render
  // the lists faster than the display can show, and a 50ms timer made short
  // jobs look chunky. One frame (~16ms) is the floor for visible updates.
  let consolePending = [];
  let pendingExecLine;   // undefined = no change
  let pendingSender;     // undefined = no change
  let flushRaf = 0;

  const flush = () => {
    flushRaf = 0;
    const patch = {};
    if (consolePending.length) {
      const lines = [...snapshot.consoleLines, ...consolePending];
      if (lines.length > MAX_CONSOLE_LINES) lines.splice(0, lines.length - MAX_CONSOLE_LINES);
      consolePending = [];
      patch.consoleLines = lines;
    }
    if (pendingExecLine !== undefined) {
      patch.execLine = pendingExecLine;
      pendingExecLine = undefined;
    }
    if (pendingSender !== undefined) {
      patch.sender = pendingSender;
      pendingSender = undefined;
    }
    if (Object.keys(patch).length) commit(patch);
  };

  const scheduleFlush = () => {
    if (!flushRaf) flushRaf = requestAnimationFrame(flush);
  };

  let nextConsoleId = 1; // stable React keys: survive ring-buffer trims
  const pushConsole = (dir, text) => {
    consolePending.push({ id: nextConsoleId++, dir, text });
    scheduleFlush();
  };

  const setExecLine = (ln) => {
    // only move forward (acks arrive in order; sender.received fallback may lag)
    if (pendingExecLine === undefined && ln > (snapshot.execLine ?? 0)) {
      pendingExecLine = ln;
      scheduleFlush();
    } else if (pendingExecLine !== undefined && ln > pendingExecLine) {
      pendingExecLine = ln;
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
      consolePending = [];
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
          patch.spindleRpm = null;
          patch.accessoryState = null;
          patch.modal = null;
          patch.spindle = null;
        }
        if (state !== ConnectionState.CONNECTING) patch.serverError = null;
        commit(patch);
      });

      connection.on('error', (err) => commit({ serverError: connectionErrorMessage(err) }));

      connection.on('startup', ({ loadedControllers }) =>
        commit({ loadedControllers: loadedControllers || [] })
      );

      connection.on('controller:settings', (controller, settings) => {
        if (controller !== 'Grbl') return;
        const { firmware, version } = settings || {};
        commit({ firmware: firmware && version ? `${firmware} ${version}` : (version || null) });
      });

      connection.on('serialport:list', (ports) => commit({ ports: ports || [] }));

      connection.on('serialport:open', ({ port, baudrate, controllerType }) =>
        commit({ connectedPort: port, controllerType, serialError: null,
          activeState: null, workflowState: null, modal: null, spindle: null,
          spindleRpm: null, accessoryState: null, ov: null, firmware: null })
      );

      connection.on('serialport:close', ({ port }) => {
        if (snapshot.connectedPort === port) {
          commit({ connectedPort: null, controllerType: null, activeState: null, workflowState: null,
            modal: null, spindle: null, spindleRpm: null, accessoryState: null, ov: null, firmware: null });
        }
      });

      connection.on('serialport:error', (err) =>
        commit({ serialError: connectionErrorMessage(err, 'Serial connection failed. Close other applications using the port, then retry.') })
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
          spindle: p.spindle ?? null,
          spindleRpm: s.spindle ?? null,
          accessoryState: s.accessoryState ?? null,
          ov: s.ov ?? null
        });
      });

      connection.on('workflow:state', (workflowState) => {
        // setExecLine only moves forward, so a new run must clear the previous
        // job's line or the viewer stays stuck on the last line.
        if (workflowState === 'running') {
          pendingExecLine = undefined;
          commit({ workflowState, execLine: null });
          return;
        }
        commit({ workflowState });
      });

      connection.on('sender:status', (sender) => {
        // received = lines GRBL has ACKed (accepted into the planner).
        // sent = lines streamed into GRBL's planner buffer (leads the cutter).
        // Folded into the same animation frame as console lines.
        pendingSender = sender || null;
        if (sender?.received != null) setExecLine(sender.received);
        scheduleFlush();
      });

      connection.on('serialport:read', (line) => {
        const text = String(line);
        pushConsole('in', text);
        // Real per-line ack from the fork patch: "> G1 X10 (ln=47)" = GRBL
        // finished line 47. Real data exclusively drives execLine + console.
        const m = /^> .+\(ln=(\d+)\)$/.exec(text);
        if (m) {
          setExecLine(Number(m[1]));
        }
      });
      connection.on('serialport:write', (data) =>
        pushConsole('out', String(data).replace(/\n$/, '')));
    }
  };

  return store;
}

// --- formatting helpers ---

export function fmtAxis(value, decimals = 3) {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(decimals) : String(value);
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
