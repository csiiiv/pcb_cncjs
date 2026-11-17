// Guided stage — park after the last operation. Always stops the spindle
// (M5), then runs the selected end program: a built-in move or a saved
// custom G-code program.
import { useMemo, useState } from 'react';
import { machineCommands, useMachineState } from '../../cnc/runtime.js';
import { setStageDone } from '../../workflow/session.js';
import { toast } from '../../ui/toast.js';
import {
  BUILTIN_PARK, NEW_PARK_ID, parkLines,
  loadCustomPark, saveCustomPark, loadLastParkId, saveLastParkId
} from '../parkPresets.js';

export default function StepPark({ done }) {
  const snap = useMachineState();
  const [customs, setCustoms] = useState(loadCustomPark);
  const [selectedId, setSelectedId] = useState(loadLastParkId);
  const [draftName, setDraftName] = useState('');
  const [draftGcode, setDraftGcode] = useState('G21\nG91\nG0 Z2\nG90\n');
  const [error, setError] = useState(null);

  const programs = useMemo(() => [...BUILTIN_PARK, ...customs], [customs]);
  const adding = selectedId === NEW_PARK_ID;
  const selected = programs.find((p) => p.id === selectedId) || BUILTIN_PARK[0];
  const lines = adding ? [] : parkLines(selected.gcode);
  const preview = ['M5', ...lines];

  const busy = ['running', 'paused'].includes(snap.workflowState)
    || snap.activeState === 'Run'
    || snap.activeState === 'Hold'
    || snap.activeState === 'Jog';
  const alarm = snap.activeState === 'Alarm' || snap.activeState === 'Door';
  const canSend = Boolean(snap.connectedPort) && !busy && !alarm && lines.length > 0;

  const choose = (id) => {
    setSelectedId(id);
    setError(null);
    if (id !== NEW_PARK_ID) saveLastParkId(id);
  };

  const park = () => {
    setError(null);
    try {
      machineCommands.runGcode(preview);
      setStageDone('park', true, { preset: selected.id });
      toast(`Spindle off — ${selected.name}`);
    } catch (err) {
      setError(err.message);
    }
  };

  const saveDraft = () => {
    const name = draftName.trim();
    const gcode = draftGcode.trim();
    if (!name) { setError('Name the program'); return; }
    if (!parkLines(gcode).length) { setError('Program has no G-code lines'); return; }
    if (parkLines(gcode).length > 40) { setError('Keep a park program under 40 lines'); return; }
    const item = { id: `custom-${Date.now().toString(36)}`, name, gcode, custom: true };
    const next = saveCustomPark([...customs, item]);
    setCustoms(next.map((p) => ({ ...p, custom: true })));
    choose(item.id);
    setDraftName('');
    toast(`Saved “${name}”`);
  };

  const removeSelected = () => {
    if (!selected.custom) return;
    const next = saveCustomPark(customs.filter((p) => p.id !== selected.id));
    setCustoms(next.map((p) => ({ ...p, custom: true })));
    choose(BUILTIN_PARK[0].id);
  };

  return (
    <div className="gw-step">
      <p className="gw-status">
        <span className={`tag ${done ? 'ok' : ''}`}>{done ? 'parked' : 'not parked'}</span>
        {snap.activeState && <span className={`tag ${alarm ? 'alarm' : ''}`}>{snap.activeState}</span>}
      </p>

      <ol className="guide-steps">
        <li>Wait until the last operation has finished and the machine is idle.</li>
        <li>Pick an end program. Spindle stop (M5) is always sent first.</li>
        <li>Park. The tool rises before any XY travel so it clears the board.</li>
      </ol>

      <label className="gw-conn-row">
        <span className="label">End program</span>
        <select value={adding ? NEW_PARK_ID : selected.id} onChange={(e) => choose(e.target.value)}>
          {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value={NEW_PARK_ID}>Add new custom G-code…</option>
        </select>
        {selected.custom && <button onClick={removeSelected}>Delete</button>}
      </label>

      {adding ? (
        <div className="gw-park-draft">
          <label className="gw-conn-row">
            <span className="label">Name</span>
            <input value={draftName} placeholder="e.g. Rise 5 mm, park back-left" onChange={(e) => setDraftName(e.target.value)} />
          </label>
          <textarea
            className="gw-park-code"
            rows={6}
            spellCheck={false}
            value={draftGcode}
            onChange={(e) => setDraftGcode(e.target.value)}
            aria-label="Custom park G-code"
          />
          <div className="gw-actions">
            <button className="primary" onClick={saveDraft}>Save program</button>
            <button onClick={() => choose(BUILTIN_PARK[0].id)}>Cancel</button>
          </div>
          <p className="hint">M5 is still sent first. Use G91 for a relative rise and G90 before any XY move.</p>
        </div>
      ) : (
        <>
          <pre className="gw-park-preview" aria-label="Program that will be sent">{preview.join('\n')}</pre>
          <div className="gw-actions">
            <button className="primary" disabled={!canSend} onClick={park}>
              {done ? 'Park again' : 'Stop spindle & park'}
            </button>
          </div>
          {!snap.connectedPort && <p className="hint">Machine port is closed — connect before parking.</p>}
          {alarm && <p className="hint">GRBL is in Alarm — unlock before parking.</p>}
          {busy && <p className="hint">Wait until the machine is idle.</p>}
          {done && <p className="hint">Park sent. You can run it again, or continue to inspect the board.</p>}
        </>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
