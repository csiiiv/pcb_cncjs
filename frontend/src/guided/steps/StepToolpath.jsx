// Guided stage 4 — select the toolpath. Lists generated CAM operations;
// Preview loads one into the shared visualizer. This is the explicit
// hand-off point between CAM setup and machining stages: everything after
// (probe bounds, sender) references the previewed job.
import { useState } from 'react';
import { useCam } from '../../cam/store.js';
import { getCam } from '../../cam/store.js';
import { loadCamOperation } from '../../cam/preview.js';
import { useViz } from '../../visualizer/vizStore.js';
import { store as machineStore } from '../../cnc/runtime.js';
import { useSession } from '../../workflow/session.js';

export default function StepToolpath({ done }) {
  const cam = useCam();
  const v = useViz();
  const session = useSession();
  const [error, setError] = useState(null);

  const ops = cam.result?.operations || [];
  const previewingId = v.job?.operationId ?? null;
  const busy = ['running', 'paused'].includes(machineStore.getSnapshot().workflowState);

  const preview = (op) => {
    if (busy) return;
    // reconcile from the viz store (bindReconciler watches job.operationId)
    const camOp = getCam().result?.operations.find((o) => o.id === op.id);
    if (!camOp) { setError('CAM result missing for this operation — regenerate'); return; }
    try { loadCamOperation(camOp); setError(null); }
    catch (err) { setError(err.message); }
  };

  return (
    <div className="gw-step">
      <p className="gw-status">
        {ops.length > 0 && <span className="tag ok">{ops.length} operations</span>}
        {previewingId && <span className="tag ok">previewing: {ops.find((o) => o.id === previewingId)?.name ?? previewingId}</span>}
        {cam.result == null && <span className="tag warn">no CAM results — generate first</span>}
      </p>

      <ol className="guide-steps">
        <li>Preview each operation; load the one you'll machine first — usually isolation.</li>
        <li>Inspect the 3D path: trace clearance, depths, no stray moves onto the board.</li>
        <li>Return here between operations to load the next toolpath.</li>
      </ol>

      <div className="gw-results">
        {ops.length === 0 && <p className="hint">Nothing generated yet — go back to the Generate step.</p>}
        {ops.map((op) => {
          const previewing = previewingId === op.id;
          const opRecord = session?.operations?.find((o) => o.id === op.id);
          return (
            <div key={op.id} className={`gw-op ${previewing ? 'active' : ''} ${opRecord ? `op-${opRecord.status}` : ''}`}>
              <div>
                <b>{op.name}</b>
                <div className="hint">{op.tool} · Z {op.depth} mm · F {op.feed} · {op.rpm} RPM</div>
              </div>
              {opRecord && (
                <span className={`tag ${['done', 'skipped'].includes(opRecord.status) ? 'ok' : opRecord.status === 'failed' ? 'bad' : ''}`}>
                  {opRecord.status}
                </span>
              )}
              <span className="spacer" />
              <button
                className={previewing ? '' : 'primary'}
                disabled={previewing || busy}
                onClick={() => preview(op)}
                title="load this operation into the shared visualizer"
              >{previewing ? '✓ Previewing' : 'Preview'}</button>
            </div>
          );
        })}
      </div>

      {error && <div className="error">{error}</div>}
      {done && <p className="hint">Previewed job anchors the next stages. Switching toolpaths re-anchors them.</p>}
    </div>
  );
}
