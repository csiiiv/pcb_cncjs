// Probe wiring gate: every UI-initiated probing move (touch probe, autolevel
// map, repeatability test) funnels through requestProbeStart. With the
// confirmation enabled (default) the wiring-check modal must be confirmed
// before the motion fires — G38.2 that never sees contact drives the full
// travel at probe feed straight into the workpiece.
import { useSyncExternalStore } from 'react';
import { getDefaults, getAllDefaults, saveDefaults } from '../settings/store.js';

let pending = null; // { kind, detail, run } | null
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };

export const getWiringCheck = () => pending;
export function useWiringCheck() { return useSyncExternalStore(subscribe, getWiringCheck); }

/**
 * Gate a probe start. `run` fires immediately when the operator disabled the
 * confirmation (Settings → Probe → "Confirm probe wiring"), otherwise the
 * wiring modal opens and `run` fires only on explicit confirmation.
 * `kind`: 'touch' | 'map' | 'test'; `detail`: e.g. "36 points".
 */
export function requestProbeStart({ kind, detail = null, run }) {
  if (typeof run !== 'function') return;
  if (getDefaults('probe')?.confirmWiring === false) { run(); return; }
  pending = { kind, detail, run };
  emit();
}

/** Operator confirmed the wiring check — fire the gated run. */
export function confirmWiringStart() {
  const p = pending;
  pending = null;
  emit();
  p?.run();
}

export function cancelWiringStart() {
  pending = null;
  emit();
}

/** Persisted "don't ask again" (Settings → Probe mirrors this field). */
export function setWiringConfirmEnabled(enabled) {
  const next = getAllDefaults();
  next.probe = { ...next.probe, confirmWiring: enabled === true };
  saveDefaults(next); // validates like any settings save
}
