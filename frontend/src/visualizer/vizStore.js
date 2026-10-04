// Tiny observable for visualizer-shared state (job, selection, scene handle).
// Widgets (G-code preview, future probe planner, repair) subscribe via useViz().
import { useEffect, useState } from 'react';

const listeners = new Set();
export const viz = { job: null, selection: null, scene: null };

export function setViz(patch) {
  Object.assign(viz, patch);
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
