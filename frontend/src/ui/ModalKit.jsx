// Shared side-modal plumbing: drag-to-resize edge + a modal stack for
// correct Escape/close-layering when multiple modals are open at once.
import { useEffect, useState } from 'react';

// --- modal stack -------------------------------------------------------------
// Portals mount in open order, so later modals paint above earlier ones.
// The stack answers "is THIS modal the top one?" so Escape only closes the
// top modal instead of every open modal at once.
const stack = [];
export function pushModal(id) { stack.push(id); }
export function popModal(id) {
  const i = stack.lastIndexOf(id);
  if (i >= 0) stack.splice(i, 1);
}
export function isTopModal(id) { return stack[stack.length - 1] === id; }

/** Register this modal in the stack while open. */
export function useModalStack(open, id) {
  useEffect(() => {
    if (!open) return undefined;
    pushModal(id);
    return () => popModal(id);
  }, [open, id]);
}

// --- persisted width ----------------------------------------------------------
/** Sidebar-modal width in px, persisted to localStorage per modal key. */
export function useModalWidth(key, initial = 400) {
  const [width, setWidth] = useState(() => {
    try {
      const v = Number(localStorage.getItem(`pcb-cnc.modal.${key}`));
      return Number.isFinite(v) && v >= 260 && v <= 1200 ? v : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(`pcb-cnc.modal.${key}`, String(Math.round(width))); } catch { /* private mode */ }
  }, [width, key]);
  return [width, setWidth];
}

/**
 * Left-edge drag handle for right-docked panels: dragging left widens.
 * Clamp keeps the viewer usable and the modal on screen.
 */
export function ResizeEdge({ width, setWidth, min = 300 }) {
  const onDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = width;
    const move = (ev) => {
      const max = Math.min(1000, window.innerWidth - 60);
      setWidth(Math.max(min, Math.min(max, startW + (startX - ev.clientX))));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return <div className="modal-resize-edge" onPointerDown={onDown} title="drag to resize" />;
}
