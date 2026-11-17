// Header UI modes: each mode is a composition of the same store-backed
// widgets (docs/ui-modes.md). Debug = existing dock; guided/test to follow.
import { lazy } from 'react';

export const MODE_STORAGE_KEY = 'pcb-cnc.mode.v1';
export const MODES = {
  debug: { id: 'debug', title: 'Debug', icon: '⌗', component: null }, // DockShell, wired in App
  guided: { id: 'guided', title: 'Guided Milling', icon: '◷', component: lazy(() => import('./GuidedMode.jsx')) },
  test: { id: 'test', title: 'Tool Testing', icon: '⚙', component: lazy(() => import('./ToolTestingMode.jsx')) }
};
export const MODE_IDS = Object.keys(MODES);

export function loadMode() {
  // ?mode= share/debug link wins once; stored mode otherwise; guided default.
  const params = new URLSearchParams(globalThis.location?.search || '');
  const fromUrl = params.get('mode');
  if (fromUrl && MODE_IDS.includes(fromUrl)) return fromUrl;
  try {
    const saved = localStorage.getItem(MODE_STORAGE_KEY);
    if (saved && MODE_IDS.includes(saved)) return saved;
  } catch { /* storage unavailable */ }
  return 'guided';
}

export function saveMode(mode) {
  try { localStorage.setItem(MODE_STORAGE_KEY, mode); } catch { /* ignore */ }
}

/** Pending cross-mode focus request: setMode(mode, { focusWidget }) →
 *  receiving mode spotlights that widget on mount (ui-modes.md §6). */
export const modeRouting = { mode: null, focusWidget: null };
export function routeMode(mode, focus) {
  modeRouting.mode = mode;
  modeRouting.focusWidget = focus ?? null;
}
export function takeModeRouting() {
  const pending = { mode: modeRouting.mode, focusWidget: modeRouting.focusWidget };
  modeRouting.mode = null;
  modeRouting.focusWidget = null;
  return pending.focusWidget ? pending : { mode: null, focusWidget: null };
}
