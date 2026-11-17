// Guided workflow wizard: one dedicated modal walking the workflow stages with
// purpose-built step views (guided/steps/*). Replaces the embedded-Debug-
// widgets stage panel for a consistent guided UX. Same stores + commands
// underneath; workflow/reconcile.js still marks stages from real events.
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { STAGES, useSession, currentStage } from '../workflow/session.js';
import { openGuide } from '../workflow/guide.js';
import { ResizeEdge, useModalStack, useModalWidth, isTopModal } from '../ui/ModalKit.jsx';
import StepConnect from './steps/StepConnect.jsx';
import StepCam from './steps/StepCam.jsx';
import StepToolpath from './steps/StepToolpath.jsx';
import StepZeroXY from './steps/StepZeroXY.jsx';
import StepZeroZ from './steps/StepZeroZ.jsx';
import StepVerifyBounds from './steps/StepVerifyBounds.jsx';
import StepSurface from './steps/StepSurface.jsx';
import StepOperations from './steps/StepOperations.jsx';
import StepPark from './steps/StepPark.jsx';
import StepFinish from './steps/StepFinish.jsx';

const WIZARD_ID = 'guided-wizard';

const STEP_VIEWS = {
  connected: StepConnect,
  imported: StepCam,
  generated: StepCam,
  toolpath: StepToolpath,
  zeroedXY: StepZeroXY,
  zeroedZ: StepZeroZ,
  verifyBounds: StepVerifyBounds,
  surface: StepSurface,
  compensated: StepSurface,
  operations: StepOperations,
  park: StepPark,
  finish: StepFinish
};

export default function GuidedWizard({ open, stageId, onClose, onNavigate }) {
  const session = useSession();
  const [width, setWidth] = useModalWidth('guided-wizard', 520);
  useModalStack(open, WIZARD_ID);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape' && isTopModal(WIZARD_ID)) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !stageId) return null;
  const stage = STAGES.find((s) => s.id === stageId);
  if (!stage) return null;
  const StepView = STEP_VIEWS[stageId];
  const index = STAGES.findIndex((s) => s.id === stageId);
  const stageDone = Boolean(session?.stages?.[stageId]?.done);
  const stageSkipped = Boolean(session?.stages?.[stageId]?.skipped);
  const cur = session ? currentStage(session) : null;
  const nextId = cur && STAGES.findIndex((s) => s.id === cur) > index ? cur : STAGES[index + 1]?.id;

  return createPortal(
    <div className="modal-backdrop side guided-wizard" style={{ width: `min(${width}px, 100vw)` }} onMouseDown={onClose}>
      <div className="modal-panel" role="dialog" aria-label={`Guided step — ${stage.title}`} onMouseDown={(e) => e.stopPropagation()}>
        <ResizeEdge width={width} setWidth={setWidth} min={420} />
        <div className="modal-head">
          <h2><span className="guide-icon">{stage.icon}</span> {stage.title}</h2>
          <span className="hint">{index + 1} of {STAGES.length}</span>
          <span className="spacer" />
          <button className="gw-help" onClick={() => openGuide(stageId, { manual: true })} title="What do I do at this step?">?</button>
          <button onClick={onClose} aria-label="Close wizard">×</button>
        </div>

        {/* compact stage rail — mirrors the subway, dots navigate */}
        <nav className="gw-rail" aria-label="Wizard stages">
          {STAGES.map((s, i) => (
            <button
              key={s.id}
              className={`gw-rail-dot ${i === index ? 'here' : ''} ${session?.stages?.[s.id]?.done ? 'done' : ''}`}
              onClick={() => onNavigate(s.id)}
              title={s.title}
              aria-current={i === index ? 'step' : undefined}
            >{s.icon}</button>
          ))}
        </nav>

        <div className="modal-body">
          {StepView && <StepView stage={stageId} done={stageDone} session={session} onNavigate={onNavigate} />}
        </div>

        <div className="modal-foot">
          <button disabled={index === 0} onClick={() => onNavigate(STAGES[index - 1].id)}>← Back</button>
          <span className="spacer" />
          {nextId && (
            <button
              className={`gw-next ${stageDone || stageSkipped ? 'ready' : ''}`}
              onClick={() => onNavigate(nextId)}
              title={stageDone || stageSkipped ? 'Step complete — continue to the next' : 'Step not done yet — jumping ahead is allowed but recorded'}
            >
              {stageDone || stageSkipped ? 'Next step →' : 'Skip ahead →'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
