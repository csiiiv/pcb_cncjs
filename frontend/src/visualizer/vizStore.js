// Tiny observable for visualizer-shared state (job, selection, scene handle)
// plus current viewer display preferences, initialized from saved defaults.
import { useEffect, useState } from 'react';

import { getDefaults } from '../settings/store.js';

const viewerRequests = new Set();
export function onShowToolpath(listener) {
  viewerRequests.add(listener);
  return () => viewerRequests.delete(listener);
}
export function showToolpath() { viewerRequests.forEach(listener => listener()); }

const listeners = new Set();
export const viz = { job: null, nominalJob: null, compensatedJob: null,
  selection: null, scene: null, prefs: getDefaults('visualizer') };

/** Imperative subscription for non-React consumers (setViz notifies). */
export const subscribeViz = (l) => { listeners.add(l); return () => listeners.delete(l); };

export function setViz(patch) {
  const changesJob = Object.prototype.hasOwnProperty.call(patch, 'job');
  // File/CAM loads establish a new original. Compensation explicitly retains
  // that original so repeated applications never use already shifted geometry.
  if (changesJob && !Object.prototype.hasOwnProperty.call(patch, 'nominalJob')) {
    viz.nominalJob = patch.job;
    viz.compensatedJob = null;
  }
  Object.assign(viz, patch);
  if (changesJob) {
    viz.selection = null;
    viz.scene?.setPreviewCursor?.(null);
    viz.scene?.setJob?.(viz.job);
    viz.scene?.setRapids?.(viz.job?.rapidMoves || []);
  }
  listeners.forEach((l) => l());
}

/** Update a display preference for the current page session. */
export function setVizPref(key, value) {
  viz.prefs = { ...viz.prefs, [key]: value };
  listeners.forEach((l) => l());
}

export function useViz() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((x) => x + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return viz;
}
