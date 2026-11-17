// Minimal toast system: transient confirmation/status messages (zero feedback
// otherwise — e.g. G10 L20 zeroing changes the DRO but confirms nothing).
let seq = 0;
let toasts = [];
const listeners = new Set();

function emit() { listeners.forEach((l) => l()); }

export function toast(message, kind = 'info') {
  const id = ++seq;
  toasts = [...toasts, { id, message: String(message), kind, at: Date.now() }];
  emit();
  setTimeout(() => dismissToast(id), kind === 'error' ? 6000 : 3200);
  return id;
}

export function dismissToast(id) {
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export const getToasts = () => toasts;
export const subscribeToasts = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
