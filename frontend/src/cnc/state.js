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
  // Raw console lines (serialport:read), newest last
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

  const store = {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
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

      connection.on('sender:status', (sender) => commit({ sender: sender || null }));

      connection.on('serialport:read', (line) => pushConsole(String(line)));
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
