import { useSyncExternalStore } from 'react';

import { getDefaults } from '../settings/store.js';
export { DEFAULT_CAM_SETTINGS } from './defaults.js';
const settings = getDefaults('cam');

let snapshot = { settings, files: {}, archive: null, result: null, generating: false, error: null };
const listeners = new Set();
export function setCam(patch) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((fn) => fn());
}
export const getCam = () => snapshot;
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export function useCam() { return useSyncExternalStore(subscribe, getCam); }
