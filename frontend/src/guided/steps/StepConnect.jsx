// Guided step 1 — server + machine port. Same controls as the Debug
// Connection widget: one-click connect, server connect/disconnect, port
// picker, open, close, and rescan. Always available, including when the
// stage is already done or a previous open failed, so the operator can
// recover the link without leaving Guided mode.
import { useEffect, useState } from 'react';
import { connection, useMachineState } from '../../cnc/runtime.js';
import { connectMachine } from '../../cnc/autoConnect.js';
import { getDefaults } from '../../settings/store.js';
import { ConnectionState } from '../../cnc/connection.js';
import { toast } from '../../ui/toast.js';

const USB_RE = /^\/dev\/tty(USB|ACM)/;

export default function StepConnect() {
  const snap = useMachineState();
  const [defaults] = useState(() => getDefaults('connection'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [picked, setPicked] = useState('');

  const serverOk = snap.server === ConnectionState.CONNECTED;
  const portOk = Boolean(snap.connectedPort);

  useEffect(() => {
    if (snap.server === ConnectionState.CONNECTED) connection.listPorts();
  }, [snap.server]);

  useEffect(() => {
    if (!snap.ports.length) { setPicked(''); return; }
    if (snap.ports.some((p) => p.port === picked)) return;
    const preferred = snap.ports.find((p) => p.port === defaults.preferredPort);
    const usb = snap.ports.find((p) => USB_RE.test(p.port));
    setPicked((preferred || usb || snap.ports[0]).port);
  }, [snap.ports, picked, defaults.preferredPort]);

  const run = async (fn) => {
    setBusy(true); setError(null);
    try { await fn(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const connectAll = () => run(async () => {
    const port = await connectMachine(connection, defaults, 5000);
    toast(`Machine connected on ${port}`);
  });

  const connectServer = () => run(async () => {
    await connection.connect();
    connection.listPorts();
  });

  const openPicked = () => run(async () => {
    if (!picked) throw new Error('select a port');
    await connection.openPort(picked, { baudrate: defaults.baudrate, controllerType: 'Grbl' });
    toast(`Machine connected on ${picked}`);
  });

  const closePort = () => run(async () => {
    const port = snap.connectedPort;
    await connection.closePort(port);
    connection.listPorts();
    toast(`Closed ${port}`);
  });

  return (
    <div className="gw-step">
      <p className="gw-status">
        <span className={`tag ${serverOk ? 'ok' : ''}`}>server {serverOk ? 'connected' : snap.server}</span>
        <span className={`tag ${portOk ? 'ok' : ''}`}>{portOk ? snap.connectedPort : 'port closed'}</span>
        {snap.activeState && <span className={`tag ${snap.activeState === 'Alarm' ? 'alarm' : ''}`}>{snap.activeState}</span>}
      </p>

      {!portOk && (
        <div className="gw-actions">
          <button className="primary" disabled={busy} onClick={connectAll}
            title="Connect the CNCjs server, then open the preferred or first USB port">
            {busy ? 'Connecting…' : 'Connect machine'}
          </button>
          <span className="hint">server + port in one click. No motion is sent.</span>
        </div>
      )}

      <div className="gw-conn-row">
        <span className="label">CNCjs server</span>
        <span className={`value c-${snap.server}`}>{snap.server}</span>
        {serverOk ? (
          <button disabled={busy} onClick={() => connection.disconnect()}>Disconnect</button>
        ) : (
          <button disabled={busy || snap.server === ConnectionState.CONNECTING} onClick={connectServer}>
            {snap.server === ConnectionState.CONNECTING ? 'Connecting…' : 'Connect'}
          </button>
        )}
      </div>
      {snap.serverError && <div className="error">server: {snap.serverError}</div>}

      {serverOk && (
        <div className="gw-conn-row">
          <span className="label">Machine port</span>
          {portOk ? (
            <>
              <span className="value ok">{snap.connectedPort}{snap.controllerType ? ` (${snap.controllerType})` : ''}</span>
              <button disabled={busy} onClick={closePort}>Close</button>
              <button disabled={busy} onClick={() => connection.listPorts()} title="rescan serial ports">Rescan</button>
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
              <button disabled={busy || !picked} onClick={openPicked}>Open</button>
              <button disabled={busy} onClick={() => connection.listPorts()} title="rescan serial ports">Rescan</button>
            </>
          )}
        </div>
      )}

      {error && <div className="error">{error}</div>}
      {snap.serialError && <div className="error">serial: {snap.serialError}</div>}

      {portOk && snap.activeState === 'Alarm' && (
        <p className="hint">Alarm after e-stop is normal — unlock from the machine column before jogging.</p>
      )}
      {portOk && (
        <p className="hint">Port is open. Close it here to pick another port, or rescan if the adapter was replugged.</p>
      )}
    </div>
  );
}
