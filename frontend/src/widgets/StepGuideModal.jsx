// Step guide modal: describes what to do for the current workflow stage
// (auto-opens as stages become current, or via the "?" affordances).
// Manual opens always show, even when auto-open was suppressed.
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { GUIDE_STAGES, useGuide, closeGuide, suppressGuide, unsuppressGuide, isSuppressed } from '../workflow/guide.js';
import { STAGES } from '../workflow/session.js';
import { focusWidget } from './focus.js';
import { useModalStack, isTopModal } from '../ui/ModalKit.jsx';

const GUIDE_MODAL_ID = 'step-guide';

export default function StepGuideModal() {
  const guide = useGuide();
  const open = Boolean(guide);
  useModalStack(open, GUIDE_MODAL_ID);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape' && isTopModal(GUIDE_MODAL_ID)) closeGuide();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!guide) return null;
  const content = GUIDE_STAGES[guide.stage];
  const stage = STAGES.find((s) => s.id === guide.stage);
  if (!content || !stage) return null;

  return createPortal(
    <div className="modal-backdrop center step-guide" onMouseDown={closeGuide}>
      <div className="modal-panel step-guide-panel" role="dialog" aria-label={`Step guide — ${content.title}`}
        onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2><span className="guide-icon">{stage.icon}</span> {content.title}</h2>
          <span className="spacer" />
          <button onClick={closeGuide} aria-label="Close guide">×</button>
        </div>
        <div className="modal-body">
          <ol className="guide-steps">
            {content.steps.map((step, i) => <li key={i}>{step}</li>)}
          </ol>
          {content.skippable && <p className="hint guide-skip-note">{content.skipNote}</p>}
          <div className="guide-done"><span className="k">done when</span> {content.done}</div>
        </div>
        <div className="modal-foot">
          <label className="check-label guide-suppress">
            <input
              type="checkbox"
              checked={isSuppressed(guide.stage)}
              onChange={(e) => (e.target.checked ? suppressGuide(guide.stage) : unsuppressGuide(guide.stage))}
            />
            Don’t auto-open for this step
          </label>
          <span className="spacer" />
          <button onClick={() => { focusWidget(stage.widget); closeGuide(); }}>
            Go to {stage.title} →
          </button>
          <button className="primary" onClick={closeGuide}>Got it</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
