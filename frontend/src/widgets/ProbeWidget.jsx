// Single-axis touch probe, laid out like the CNCjs Probe widget.
import { useState } from 'react';
import { useStoreSelector, probeCommands } from '../cnc/runtime.js';
import NumField from '../ui/NumField.jsx';

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const COMMANDS = ['G38.2', 'G38.3', 'G38.4', 'G38.5'];
const COMMAND_HINT = {
  'G38.2': 'toward the plate, stop on contact, alarm if it never hits',
  'G38.3': 'toward the plate, stop on contact',
  'G38.4': 'away from the plate, stop when contact opens, alarm if it never opens',
  'G38.5': 'away from the plate, stop when contact opens',
};

export default function ProbeWidget() {
  const port = useStoreSelector((s) => s.connectedPort);
  const wcs = useStoreSelector((s) => s.modal?.wcs);
  const [axis, setAxis] = useState('Z');
  const [command, setCommand] = useState('G38.2');
  const [depth, setDepth] = useState(10);
  const [feedrate, setFeedrate] = useState(50);
  const [plate, setPlate] = useState(0);
  const [retract, setRetract] = useState(2);
  const [error, setError] = useState(null);

  const run = () => {
    setError(null);
    try {
      probeCommands.probeAxis({ axis, command, depth, feedrate, plate, retract, wcs });
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="widget probe-widget">
      <div className="widget-head">
        <h2>Probe</h2>
      </div>
      {error && <div className="error">{error}</div>}

      <div className="probe-label">Axis</div>
      <div className="seg">
        {['Z', 'X', 'Y'].map((a) => (
          <button key={a} className={axis === a ? 'on' : ''} onClick={() => setAxis(a)}>{a}</button>
        ))}
      </div>

      <div className="probe-label">Command</div>
      <div className="seg">
        {COMMANDS.map((c) => (
          <button key={c} className={command === c ? 'on' : ''} onClick={() => setCommand(c)}>{c}</button>
        ))}
      </div>
      <p className="hint">{COMMAND_HINT[command]}</p>

      <div className="probe-fields cols-2">
        <NumField label="Depth" value={depth} onChange={setDepth} />
        <NumField label="Feed" value={feedrate} onChange={(f) => setFeedrate(Math.max(1, f))} />
        <NumField label="Plate thickness" value={plate} onChange={setPlate} />
        <NumField label="Retract" value={retract} onChange={setRetract} />
      </div>

      <div className="probe-row">
        <button disabled={!port} onClick={run}>Probe</button>
        <span className="hint">{wcs || 'G54'} · mm</span>
      </div>
    </section>
  );
}
