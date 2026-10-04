// Connection: CNCjs server + machine port.
import { useState } from 'react';
import { connection, useMachineState } from '../cnc/runtime.js';
import { ConnectionState } from '../cnc/connection.js';

export default function ConnectionWidget() {
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

  const connectPort = async () => {
    const port = snap.ports.find((p) => /^\/dev\/tty(USB|ACM)/.test(p.port));
    if (!port) return setError('no USB serial port found');
    try {
      setBusy(true);
      setError(null);
      await connection.openPort(port.port, { baudrate: 115200, controllerType: 'Grbl' });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const usbPorts = snap.ports.filter((p) => /^\/dev\/tty(USB|ACM)/.test(p.port));

  return (
    <section className="widget">
      <h2>Connection</h2>
      <div className="row">
        <span className="label">CNCjs server</span>
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
                <span className="value ok">{snap.connectedPort} ({snap.controllerType})</span>
                <button disabled={busy} onClick={() => connection.closePort(snap.connectedPort)}>Close</button>
              </>
            ) : (
              <>
                <span className="value">
                  {usbPorts.length ? usbPorts.map((p) => p.port).join(', ') : `none (${snap.ports.length} ports)`}
                </span>
                <button disabled={busy || !usbPorts.length} onClick={connectPort}>Open port</button>
              </>
            )}
          </div>
          {snap.serialError && <div className="error">serial: {snap.serialError}</div>}
        </>
      )}
    </section>
  );
}
