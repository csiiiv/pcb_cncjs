// Guided step 5 — zero Z with the touch probe. Combines probe parameters,
// the wiring check (live circuit lamp), and the probe run in one step; the
// plate-thickness G10 L20 write reconciles completion.
import { useState } from 'react';
import { probeCommands, useMachineState, useStoreSelector } from '../../cnc/runtime.js';
import { useDefaultState } from '../../settings/store.js';
import { requestProbeStart } from '../../probe/wiring.js';
import { toast } from '../../ui/toast.js';
import NumField from '../../ui/NumField.jsx';

export default function StepZeroZ({ done }) {
  const snap = useMachineState();
  const wcs = useStoreSelector((s) => s.modal?.wcs);
  const [error, setError] = useState(null);
  const [axis, setAxis] = useDefaultState('probe', 'axis');
  const [command, setCommand] = useDefaultState('probe', 'command');
  const [depth, setDepth] = useDefaultState('probe', 'depth');
  const [feedrate, setFeedrate] = useDefaultState('probe', 'feedrate');
  const [plate, setPlate] = useDefaultState('probe', 'plate');
  const [retract, setRetract] = useDefaultState('probe', 'retract');

  const enabled = Boolean(snap.connectedPort);
  const circuitClosed = (snap.pinState || '').includes('P');

  const run = () => {
    setError(null);
    requestProbeStart({
      kind: 'touch',
      detail: `${axis} · ${command}`,
      run: () => {
        try {
          probeCommands.probeAxis({ axis, command, depth, feedrate, plate, retract, wcs });
          toast(`Probing ${axis} — watch the tool, feed-hold if unsure`);
        } catch (err) {
          setError(err.message);
        }
      }
    });
  };

  return (
    <div className="gw-step">
      <p className="gw-status">
        <span className={`tag ${circuitClosed ? 'ok' : ''}`}>
          {circuitClosed ? 'circuit closed' : 'circuit open'}
        </span>
        <span className="tag">WPos Z{fmt(snap.wpos?.z)}</span>
        {snap.activeState && <span className="tag">{snap.activeState}</span>}
      </p>

      <ol className="guide-steps">
        <li>Clip the probe lead on the <b>tool shank or collet</b> (bare metal).</li>
        <li>Set the plate thickness, slide the plate under the tip — the lamp above must light.</li>
        <li>Run the probe: GRBL feeds down, stops at contact, sets Z0 = surface + plate, retracts.</li>
        <li>After any tool change, come back and re-probe Z.</li>
      </ol>

      <div className="gw-params">
        <div className="gw-param-row">
          <span className="label">Axis</span>
          <span className="seg">
            {['Z', 'X', 'Y'].map((a) => (
              <button key={a} className={axis === a ? 'on' : ''} onClick={() => setAxis(a)}>{a}</button>
            ))}
          </span>
        </div>
        <div className="gw-param-row">
          <span className="label">Command</span>
          <span className="seg">
            {['G38.2', 'G38.3', 'G38.4', 'G38.5'].map((c) => (
              <button key={c} className={command === c ? 'on' : ''} onClick={() => setCommand(c)} title={c === 'G38.2' ? 'toward plate, alarm on miss' : c === 'G38.3' ? 'toward plate' : c === 'G38.4' ? 'away from plate, alarm if no contact' : 'away from plate'}>{c}</button>
            ))}
          </span>
        </div>
        <div className="probe-fields cols-2">
          <NumField label="Plate thickness (mm)" value={plate} onChange={setPlate} />
          <NumField label="Travel depth (mm)" value={depth} onChange={setDepth} />
          <NumField label="Feed (mm/min)" value={feedrate} onChange={(f) => setFeedrate(Math.max(1, f))} />
          <NumField label="Retract (mm)" value={retract} onChange={setRetract} />
        </div>
      </div>

      <div className="gw-actions">
        <button className="primary" disabled={!enabled} onClick={run}>Probe {axis} ({command})</button>
        <span className="hint">{wcs || 'G54'} · mm</span>
      </div>
      {!enabled && <p className="hint">machine port not connected</p>}
      {error && <div className="error">{error}</div>}
      {done && <p className="hint">Z0 references the copper surface through this tool. Re-probe after tool changes.</p>}
    </div>
  );
}

const fmt = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toFixed(2));
