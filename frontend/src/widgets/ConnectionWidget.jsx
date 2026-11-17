import { ParameterLabel } from '../ui/InfoIcon.jsx';
import { parameterHelp } from '../ui/parameterHelp.js';
import { getDefaults } from '../settings/store.js';
import { toast } from '../ui/toast.js';
import { connectMachine } from '../cnc/autoConnect.js';
// Connection: CNCjs server + machine port.
import { useEffect, useRef, useState } from 'react';
import { connection, useMachineState } from '../cnc/runtime.js';
import { ConnectionState } from '../cnc/connection.js';

const USB_RE = /^\/dev\/tty(USB|ACM)/;
// Module-level: ConnectionWidget mounts in the dock AND inside the connect
// prompt modal — only one of them may own the auto-connect attempt.
const autoTriedGlobal = { current: false };

export default function ConnectionWidget() {
  const snap = useMachineState();
  const [defaults] = useState(() => getDefaults('connection'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [picked, setPicked] = useState('');

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

  // One-click machine connect: server + preferred/USB port in one action.
  const connectAll = async () => {
    try {
      setBusy(true);
      setError(null);
      const port = await connectMachine(connection, defaults, 5000);
      toast(`Machine connected on ${port}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Opt-in auto-connect on first mount only (per page load). Manual close of
  // the connect prompt must not fight an in-flight auto-connect.
  useEffect(() => {
    if (autoTriedGlobal.current || !defaults.autoConnect) return;
    autoTriedGlobal.current = true;
    let cancelled = false;
    (async () => {
      try {
        const port = await connectMachine(connection, defaults, 5000);
        if (!cancelled) toast(`Machine connected on ${port}`);
      } catch {
        // silent: the widget/modal remains the standing fallback
      }
    })();
    return () => { cancelled = true; };
  }, [defaults]);

  // Keep the list fresh whenever the server is up (dock and the connect modal
  // both mount this widget).
  useEffect(() => {
    if (snap.server !== ConnectionState.CONNECTED) return;
    connection.listPorts();
  }, [snap.server]);

  // Default the dropdown to a USB adapter, otherwise the first listed port.
  useEffect(() => {
    if (!snap.ports.length) {
      setPicked('');
      return;
    }
    if (snap.ports.some((p) => p.port === picked)) return;
    const preferred = snap.ports.find(p => p.port === defaults.preferredPort);
    const usb = snap.ports.find((p) => USB_RE.test(p.port));
    setPicked((preferred || usb || snap.ports[0]).port);
  }, [snap.ports, picked, defaults.preferredPort]);

  const connectPort = async () => {
    if (!picked) return setError('select a port');
    try {
      setBusy(true);
      setError(null);
      await connection.openPort(picked, { baudrate: defaults.baudrate, controllerType: 'Grbl' });
      toast(`Machine connected on ${picked}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const closePort = async () => {
    try {
      setBusy(true);
      setError(null);
      await connection.closePort(snap.connectedPort);
      connection.listPorts();
      toast(`Closed ${snap.connectedPort}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="widget">
      <h2>Connection</h2>
      {!snap.connectedPort && (
        <div className="row" style={{ marginBottom: 8 }}>
          <button
            className="primary"
            disabled={busy}
            onClick={connectAll}
            title="Connect the CNCjs server, then open the preferred or first USB machine port"
          >
            {busy ? 'Connecting…' : 'Connect machine'}
          </button>
          <span className="hint">server + port in one click</span>
        </div>
      )}
      <div className="row">
        <span className="label"><ParameterLabel label="CNCjs server" help={parameterHelp('connection', 'serverUrl')} /></span>
        <span className={`value c-${snap.server}`}>
          {snap.server}
        </span>
        {snap.server === ConnectionState.CONNECTED ? (
          <button onClick={() => connection.disconnect()}>Disconnect</button>
        ) : (
          <button disabled={busy || snap.server === ConnectionState.CONNECTING} onClick={connectServer}>
            {snap.server === ConnectionState.CONNECTING ? 'Connecting…' : 'Connect'}
          </button>
        )}
      </div>
      {snap.serverError && <div className="error">server: {snap.serverError}</div>}
      {error && <div className="error">{error}</div>}
      {snap.server === ConnectionState.CONNECTED && (
        <>
          <div className="row">
            <span className="label">Controllers</span>
            <span className="value">{snap.loadedControllers.join(', ')}</span>
          </div>
          <div className="row">
            <span className="label"><ParameterLabel label="Machine port" help={parameterHelp('connection', 'preferredPort')} /></span>
            {snap.connectedPort ? (
              <>
                <span className="value ok">{snap.connectedPort} ({snap.controllerType})</span>
                <button disabled={busy} onClick={closePort}>Close</button>
              </>
            ) : (
              <>
                <select
                  className="port-select"
                  value={picked}
                  disabled={busy || snap.ports.length === 0}
                  onChange={(e) => setPicked(e.target.value)}
                >
                  {snap.ports.length === 0 && <option value="">no ports</option>}
                  {snap.ports.map((p) => (
                    <option key={p.port} value={p.port}>
                      {p.port}{p.inuse ? ' (in use)' : ''}{p.manufacturer ? ` — ${p.manufacturer}` : ''}
                    </option>
                  ))}
                </select>
                <button disabled={busy || !picked} onClick={connectPort}>Open</button>
                <button disabled={busy} onClick={() => connection.listPorts()} title="rescan serial ports">Rescan</button>
              </>
            )}
          </div>
          {snap.serialError && <div className="error">serial: {snap.serialError}</div>}
        </>
      )}
    </section>
  );
}
