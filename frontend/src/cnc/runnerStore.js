// Shared job-runner state: which job is loaded into the CNCjs sender, and
// which jobs have completed a run this session. Lives outside the widget so
// the status footer, workflow guide and CAM results can read it.
import { useSyncExternalStore } from 'react';

let snapshot = { loaded: null, completed: [] }; // loaded: {name,text,port,total}
const listeners = new Set();

export function setRunnerState(patch) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((fn) => fn());
}

export const getRunnerState = () => snapshot;

const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export function useRunnerState() { return useSyncExternalStore(subscribe, getRunnerState); }

/** Record a finished run by job name (once per name per session). */
export function recordCompletedRun(name) {
  if (!name || snapshot.completed.some((r) => r.name === name)) return;
  setRunnerState({ completed: [...snapshot.completed, { name, at: Date.now() }] });
}
