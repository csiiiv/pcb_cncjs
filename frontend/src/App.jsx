import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { CNCConnection, ConnectionState } from './cnc/connection.js';
import { createMachineStateStore, fmtAxis, stateColor } from './cnc/state.js';
import './app.css';

const connection = new CNCConnection({ serverUrl: '' }); // same-origin via Vite proxy
const store = createMachineStateStore();
store.bind(connection);

function useMachineState() {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

function Led({ color }) {
  return <span className={`led led-${color}`} />;
}

function ConnectionPanel() {
  const snap = useMachineState();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const connectServer = async () => {
    try {
      setBusy(true);
      setError(null);
      await connection.connect();
      connection.listPorts();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const disconnectServer = () => {
    connection.disconnect();
  };

  const connectPort = async () => {
    try {
      setBusy(true);
      setError(null);
      await connection.openPort('/dev/ttyUSB0', { baudrate: 115200, controllerType: 'Grbl' });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const disconnectPort = async () => {
    try {
      setBusy(true);
      await connection.closePort(snap.connectedPort);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const usbPorts = snap.ports.filter((p) => /^\/dev\/tty(USB|ACM)/.test(p.port));

  return (
    <section className="panel">
      <h2>Connection</h2>

      <div className="row">
        <span className="label">CNCjs server</span>
        <span className={`value c-${snap.server}`}>
          <Led color={snap.server} />
          {snap.server}
        </span>
        {snap.server === ConnectionState.CONNECTED ? (
          <button onClick={disconnectServer}>Disconnect</button>
        ) : (
          <button disabled={busy || snap.server === ConnectionState.CONNECTING} onClick={connectServer}>
            {snap.server === ConnectionState.CONNECTING ? 'Connecting…' : 'Connect'}
          </button>
        )}
      </div>

      {snap.serverError && <div className="error">server: {snap.serverError}</div>}

      {snap.server === ConnectionState.CONNECTED && (
        <>
          <div className="row">
            <span className="label">Controllers</span>
            <span className="value">{snap.loadedControllers.join(', ')}</span>
          </div>

          <div className="row">
            <span className="label">Machine port</span>
            {snap.connectedPort ? (
              <>
                <span className="value ok">
                  <Led color="ok" />
                  {snap.connectedPort} ({snap.controllerType})
                </span>
                <button disabled={busy} onClick={disconnectPort}>Close port</button>
              </>
            ) : (
              <>
                <span className="value">
                  {usbPorts.length
                    ? usbPorts.map((p) => p.port).join(', ')
                    : `no USB ports (${snap.ports.length} total)`}
                </span>
                <button
                  disabled={busy || !usbPorts.length}
                  onClick={connectPort}
                  title="Opens the serial port. Note: this may reset GRBL (DTR)."
                >
                  Open port
                </button>
              </>
            )}
          </div>

          {snap.serialError && <div className="error">serial: {snap.serialError}</div>}
        </>
      )}
    </section>
  );
}

function DroAxis({ name, value, primary }) {
  return (
    <div className={`dro-axis ${primary ? 'primary' : ''}`}>
      <span className="axis-name">{name}</span>
      <span className="axis-value">{fmtAxis(value)}</span>
    </div>
  );
}

function DRO() {
  const snap = useMachineState();
  const linked = Boolean(snap.connectedPort);
  const units = snap.modal?.units === 'G21' ? 'mm' : snap.modal?.units === 'G20' ? 'in' : '';

  return (
    <section className={`panel dro ${linked ? '' : 'dimmed'}`}>
      <div className="dro-head">
        <h2>Work Position</h2>
        {units && <span className="units">{units}</span>}
      </div>
      <div className="dro-grid">
        <DroAxis name="X" value={snap.wpos?.x} primary />
        <DroAxis name="Y" value={snap.wpos?.y} primary />
        <DroAxis name="Z" value={snap.wpos?.z} primary />
      </div>
      <div className="dro-head secondary">
        <h3>Machine Position</h3>
        <span className="hint">diagnostic only</span>
      </div>
      <div className="dro-grid secondary">
        <DroAxis name="X" value={snap.mpos?.x} />
        <DroAxis name="Y" value={snap.mpos?.y} />
        <DroAxis name="Z" value={snap.mpos?.z} />
      </div>
    </section>
  );
}

function StatusPanel() {
  const snap = useMachineState();

  const rows = [
    ['GRBL state', snap.activeState ?? '—'],
    ['Sub state', snap.subState ?? '—'],
    ['Workflow', snap.workflowState ?? '—'],
    ['Units', snap.modal?.units ?? '—'],
    ['Distance mode', snap.modal?.distance ?? '—'],
    ['WCS', snap.modal?.wcs ?? '—'],
    ['Feed', snap.feedrate ?? '—'],
    ['Pin state', snap.pinState ?? '—']
  ];

  return (
    <section className="panel">
      <h2>Status</h2>
      <div className={`state-banner ${stateColor(snap.activeState)}`}>
        {snap.activeState ?? 'NO DATA'}
      </div>
      <table className="kv">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td>{k}</td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Console() {
  const snap = useMachineState();
  const ref = useRef(null);
  const [autoscroll, setAutoscroll] = useState(true);

  useEffect(() => {
    if (autoscroll && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [snap.consoleLines, autoscroll]);

  return (
    <section className="panel console-panel">
      <div className="dro-head">
        <h2>Console</h2>
        <label className="hint">
          <input
            type="checkbox"
            checked={autoscroll}
            onChange={(e) => setAutoscroll(e.target.checked)}
          />
          autoscroll
        </label>
      </div>
      <div className="console" ref={ref}>
        {snap.consoleLines.length === 0 && <div className="hint">no serial data yet</div>}
        {snap.consoleLines.map((line, i) => (
          <div key={i} className="console-line">{line}</div>
        ))}
      </div>
    </section>
  );
}

export default function App() {
  const snap = useMachineState();

  return (
    <div className="app">
      <header className="app-header">
        <h1>PCB CNC</h1>
        <span className="tag">Phase 1 — read-only</span>
        <span className={`tag ${stateColor(snap.activeState)}`}>
          {snap.connectedPort ? snap.activeState ?? '—' : 'port closed'}
        </span>
      </header>
      <main className="layout">
        <ConnectionPanel />
        <DRO />
        <StatusPanel />
        <Console />
      </main>
    </div>
  );
}
