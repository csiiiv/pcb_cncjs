// Fixed toast stack, bottom-right above the status footer.
import { useSyncExternalStore } from 'react';
import { dismissToast, getToasts, subscribeToasts } from './toast.js';

export default function ToastHost() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts);
  if (!toasts.length) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismissToast(t.id)}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
