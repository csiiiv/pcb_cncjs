import { useState } from 'react';
import { getDefaults } from '../settings/store.js';
// DRO: Work position (primary) + machine position (diagnostic).
import { useMachineState, fmtAxis } from '../cnc/runtime.js';

export default function DroWidget() {
  const [defaults] = useState(() => getDefaults('dro'));
  const snap = useMachineState();
  const units = snap.modal?.units === 'G21' ? 'mm' : snap.modal?.units === 'G20' ? 'in' : '';

  return (
    <section className={`widget dro ${snap.connectedPort ? '' : 'dimmed'}`}>
      <div className="dro-head">
        <h2>Work Position</h2>
        {units && <span className="units">{units}</span>}
      </div>
      <div className="dro-grid">
        {['x', 'y', 'z'].map((a) => (
          <div key={a} className="dro-axis primary">
            <span className="axis-name">{a.toUpperCase()}</span>
            <span className="axis-value">{fmtAxis(snap.wpos?.[a], defaults.decimals)}</span>
          </div>
        ))}
      </div>
      {defaults.showMachine && <>
      <div className="dro-head secondary">
        <h3>Machine Position</h3>
        <span className="hint">diagnostic only</span>
      </div>
      <div className="dro-grid secondary">
        {['x', 'y', 'z'].map((a) => (
          <div key={a} className="dro-axis">
            <span className="axis-name">{a.toUpperCase()}</span>
            <span className="axis-value">{fmtAxis(snap.mpos?.[a], defaults.decimals)}</span>
          </div>
        ))}
      </div>
      </>}
    </section>
  );
}
