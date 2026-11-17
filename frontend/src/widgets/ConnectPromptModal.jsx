// Startup overlay: the same Connection widget as the dock, plus Cancel.
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useMachineState } from '../cnc/runtime.js';
import { useModalStack, isTopModal } from '../ui/ModalKit.jsx';
import ConnectionWidget from './ConnectionWidget.jsx';

export default function ConnectPromptModal({ open, onCancel }) {
  const snap = useMachineState();
  useModalStack(open, 'connect-prompt');

  // Close once a machine port is actually open.
  useEffect(() => {
    if (open && snap.connectedPort) onCancel();
  }, [open, snap.connectedPort, onCancel]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && isTopModal('connect-prompt')) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return createPortal(
    <div className="modal-backdrop center connect-prompt">
      <div className="modal-panel" role="dialog" aria-label="Connect to machine">
        <div className="modal-head">
          <h2>Connect</h2>
          <span className="spacer" />
          <button onClick={onCancel} title="close">×</button>
        </div>
        <div className="modal-body">
          <ConnectionWidget />
        </div>
        <div className="modal-foot">
          <span className="hint">you can connect later from the Connection widget</span>
          <span className="spacer" />
          <button onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
