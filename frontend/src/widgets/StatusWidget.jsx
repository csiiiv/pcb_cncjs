// GRBL status banner + key-value rows.
import { useMachineState, stateColor } from '../cnc/runtime.js';

export default function StatusWidget() {
  const snap = useMachineState();

  const rows = [
    ['GRBL state', snap.activeState ?? '—'],
    ['Sub state', snap.subState ?? '—'],
    ['Workflow', snap.workflowState ?? '—'],
    ['Units', snap.modal?.units ?? '—'],
    ['Distance mode', snap.modal?.distance ?? '—'],
    ['WCS', snap.modal?.wcs ?? '—'],
    [
      'WCO (G54 offset)',
      snap.wco
        ? `X ${snap.wco.x ?? '—'}  Y ${snap.wco.y ?? '—'}  Z ${snap.wco.z ?? '—'}`
        : '—'
    ],
    ['Feed', snap.feedrate ?? '—'],
    ['Pin state', snap.pinState ?? '—']
  ];

  return (
    <section className="widget">
      <h2>Status</h2>
      <div className={`state-banner ${stateColor(snap.activeState)}`}>
        {snap.activeState ?? 'NO DATA'}
      </div>
      <table className="kv">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}><td>{k}</td><td>{v}</td></tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
