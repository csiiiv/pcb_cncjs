import { useState } from 'react';
import { FACTORY_DEFAULTS, SETTINGS_TABS, getPath, setPath, settingsErrors } from './schema.js';
export const SETTINGS_KEY = 'pcb-cnc.defaults.v1';

export function loadDefaults(storage) {
  const defaults = structuredClone(FACTORY_DEFAULTS);
  try {
    const saved = JSON.parse(storage.getItem(SETTINGS_KEY) || 'null');
    // Upgrade existing settings once; the central defaults take precedence.
    const legacy = saved || {
      cam: JSON.parse(storage.getItem('pcb-cnc.cam.settings.v1') || 'null'),
      spindle: { rpm: Number(storage.getItem('pcb-cnc-spindle-rpm') ?? 1000) },
      visualizer: JSON.parse(storage.getItem('pcb-cnc.viz.prefs.v1') || 'null')
    };
    for (const tab of SETTINGS_TABS) {
      const candidate = structuredClone(defaults);
      if (tab.id === 'tooltest' && legacy?.tooltest && legacy.tooltest.pattern === undefined) candidate.tooltest.pattern = 'grooves';
      for (const field of tab.fields || tab.groups.flatMap(group => group.fields)) {
        const value = getPath(legacy?.[tab.id], field.key);
        if (value !== undefined) setPath(candidate[tab.id], field.key, value);
      }
      if (!settingsErrors(candidate, tab.id).length) defaults[tab.id] = candidate[tab.id];
    }
  } catch { /* Invalid or unavailable storage falls back to factory defaults. */ }
  return defaults;
}
let values = loadDefaults(globalThis.localStorage);
export const getAllDefaults = () => structuredClone(values);
export const getDefaults = (section) => structuredClone(values[section]);
export function saveDefaults(next) {
  const errors = settingsErrors(next);
  if (errors.length) throw new Error(errors.join(' '));
  // Report failed persistence instead of claiming the defaults were saved.
  globalThis.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  values = structuredClone(next);
}
export function useDefaultState(section, key) {
  return useState(() => getPath(getDefaults(section), key));
}
