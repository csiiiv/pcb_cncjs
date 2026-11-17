// Guided finish — inspect and archive. Parking is the previous stage.
import { machineCommands } from '../../cnc/runtime.js';
import { useMachineState } from '../../cnc/runtime.js';
import { useSession, abandonSession, setStageDone } from '../../workflow/session.js';
import { toast } from '../../ui/toast.js';

export default function StepFinish({ done }) {
  const snap = useMachineState();
  const session = useSession();
  const ops = session?.operations || [];
  const doneCount = ops.filter((o) => ['done', 'skipped'].includes(o.status)).length;
  const allDone = doneCount === ops.length && ops.length > 0;

  return (
    <div className="gw-step">
      <p className="gw-status">
        <span className={`tag ${allDone ? 'ok' : ''}`}>{doneCount}/{ops.length} operations complete</span>
        {snap.activeState && <span className="tag">{snap.activeState}</span>}
      </p>

      <ol className="guide-steps">
        <li>Confirm the tool is parked clear of the board.</li>
        <li>Vacuum the board before judging isolation quality.</li>
        <li>Inspect traces under magnification — slivers and depth variation show up now.</li>
        <li>Drill/outline ran last; snap the tabs and deburr the edge.</li>
        <li>Archive this board when satisfied.</li>
      </ol>

      <div className="gw-actions">
        <button onClick={() => machineCommands.spindleStop()} disabled={!snap.connectedPort}>Spindle off</button>
        <button
          className="primary"
          disabled={done}
          onClick={() => {
            setStageDone('finish', true);
            toast('Board complete — session archived');
          }}
        >{done ? 'Archived' : 'Mark board complete'}</button>
        {done && (
          <button onClick={() => { if (confirm('Start a new board session? This clears the current one.')) abandonSession(); }}>
            New board
          </button>
        )}
      </div>
      {!allDone && <p className="hint">Finish unlocks when every operation is done or skipped.</p>}
    </div>
  );
}
