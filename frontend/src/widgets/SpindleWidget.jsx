import { ParameterLabel } from '../ui/InfoIcon.jsx';
import { parameterHelp } from '../ui/parameterHelp.js';
import { getDefaults } from '../settings/store.js';
import { useState } from 'react';
import { machineCommands, store, useStoreSelector } from '../cnc/runtime.js';
import { canControlSpindle, reportedSpindleMode } from '../cnc/spindle.js';

export default function SpindleWidget() {
  const enabled = useStoreSelector(canControlSpindle);
  const mode = useStoreSelector(reportedSpindleMode);
  const live = useStoreSelector((s) => s.server === 'connected' && Boolean(s.connectedPort));
  const reportedRpm = useStoreSelector((s) => s.spindleRpm);
  const programmedRpm = useStoreSelector((s) => s.spindle);
  const [speed, setSpeed] = useState(() => String(getDefaults('spindle').rpm));
  const [error, setError] = useState(null);
  const rpm = Number(speed);
  const valid = speed.trim() !== '' && Number.isSafeInteger(rpm) && rpm >= 0;

  const send = (action) => {
    // Recheck the current snapshot at click time, including queued status updates.
    if (!canControlSpindle(store.getSnapshot())) return;
    try {
      action();
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="widget spindle-widget" aria-label="Spindle controls">
      <h2>Spindle</h2>
      <div className="row" aria-live="polite">
        <span className={`tag ${mode === 'M3' || mode === 'M4' ? 'busy' : ''}`}>
          {{ M3: 'CW · M3', M4: 'CCW · M4', M5: 'Off · M5' }[mode] ?? 'Unknown'}
        </span>
        <span className="hint">Reported: {live ? reportedRpm ?? '—' : '—'} RPM</span>
      </div>
      <div className="seg" role="group" aria-label="Spindle direction">
        <button className={`toggle ${mode === 'M3' ? 'on' : ''}`}
          disabled={!enabled || !valid} title="Clockwise spindle on (M3)"
          onClick={() => send(() => machineCommands.spindleStart('M3', rpm))}>↻ CW (M3)</button>
        <button className={`toggle ${mode === 'M4' ? 'on' : ''}`}
          disabled={!enabled || !valid} title="Counterclockwise spindle on (M4)"
          onClick={() => send(() => machineCommands.spindleStart('M4', rpm))}>↺ CCW (M4)</button>
        <button disabled={!enabled} title="Spindle off (M5)"
          onClick={() => send(() => machineCommands.spindleStop())}>Stop (M5)</button>
      </div>
      <div className="spindle-speed">
        <label htmlFor="spindle-rpm"><ParameterLabel label="Speed (RPM)" help={parameterHelp('spindle', 'rpm')} /></label>
        <input id="spindle-rpm" type="number" min="0" step="1" value={speed}
          aria-invalid={!valid} onChange={(e) => setSpeed(e.target.value)} />
        <button disabled={!enabled || !valid}
          title="Apply spindle speed (S) without changing direction"
          onClick={() => send(() => machineCommands.spindleSpeed(rpm))}>Apply</button>
      </div>
      <div className="hint">Programmed: {live ? programmedRpm ?? '—' : '—'} RPM</div>
      {!valid && <div className="error">Enter a non-negative whole RPM value.</div>}
      {!enabled && <p className="hint">Manual spindle controls require connected GRBL in Idle or Hold with no running job.</p>}
      {error && <div className="error" role="alert">{error}</div>}
    </section>
  );
}
