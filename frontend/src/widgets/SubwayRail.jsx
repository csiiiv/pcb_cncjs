// Subway rail: the workflow stages as a vertical subway line with
// icon + label stations (ui-modes.md §4). Station state comes from the
// session store + live gate evaluation; clicking selects the stage (its
// panel opens in the center column). The footer's next → button reaches
// stations via focus.js using the same data-widget attribute.
import { STAGES, currentStage, useSession, operationsComplete } from '../workflow/session.js';
import { openGuide } from '../workflow/guide.js';

function stationClass(stageId, session, gates) {
  const done = session?.stages?.[stageId]?.done;
  if (done) return 'done';
  if (currentStage(session) === stageId) return gates.get(stageId)?.blocked ? 'blocked' : 'current';
  return 'future';
}

export default function SubwayRail({ gates, onSelectStage, selectedStage }) {
  const session = useSession();
  if (!session) return null;
  const ops = session.operations || [];
  const doneOps = ops.filter((o) => ['done', 'skipped'].includes(o.status));
  const finishReady = operationsComplete(session);

  return (
    <nav className="subway-rail" aria-label="Workflow stages">
      {STAGES.map((st, i) => {
        const cls = stationClass(st.id, session, gates);
        const gate = gates.get(st.id);
        const isOps = st.id === 'operations';
        return (
          <div key={st.id} className={`subway-station-wrap ${cls}`}>
            <div className="subway-station-row">
              <button
                className={`subway-station ${cls} ${selectedStage === st.id ? 'selected' : ''}`}
                data-widget={st.widget}
                onClick={() => onSelectStage?.(st.id)}
                title={gate?.blocked ? gate.reason : st.title}
                aria-current={cls === 'current' ? 'step' : undefined}
              >
                <span className="station-icon">{st.icon}</span>
                <span className="station-label">{st.title}</span>
                {cls === 'blocked' && <span className="station-flag">!</span>}
                {st.id === 'verifyBounds' && session.stages.verifyBounds?.skipped && <span className="station-flag skip">⤼</span>}
                {st.id === 'surface' && session.stages.surface?.skipped && <span className="station-flag skip">⤼</span>}
                {st.id === 'compensated' && session.stages.compensated?.skipped && <span className="station-flag skip">⤼</span>}
              </button>
              <button
                className="station-guide-btn"
                onClick={() => openGuide(st.id, { manual: true })}
                title={`Guide: ${st.title}`}
                aria-label={`Guide for ${st.title}`}
              >?</button>
            </div>
            {isOps && ops.length > 0 && (
              <ul className="subway-ops">
                {ops.map((op) => (
                  <li key={op.id} className={`op-row op-${op.status}`} onClick={() => onSelectStage?.('operations')}>
                    <span className="op-name">{op.name}</span>
                    <span className="op-status">
                      {op.status === 'running' ? '▶' : op.status === 'done' ? '✓' : op.status === 'failed' ? '✗' : op.status === 'skipped' ? '⤼' : '•'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {st.id === 'finish' && finishReady && (
              <div className="subway-finish-hint">{doneOps.length}/{ops.length} operations complete</div>
            )}
            {i < STAGES.length - 1 && <span className="subway-track" aria-hidden="true" />}
          </div>
        );
      })}
    </nav>
  );
}
