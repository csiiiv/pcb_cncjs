import { useSyncExternalStore } from 'react';
import { toolTestErrors } from '../tooltest/config.js';

export const TOOL_PROFILES_KEY = 'pcb-cnc.tool-profiles.v1';
export function validateProfile(profile) {
  if (!profile || typeof profile.name !== 'string' || !profile.name.trim() || profile.name.length > 80) throw new Error('Enter a profile name (up to 80 characters).');
  for (const key of ['angle', 'tip', 'depth', 'diameter', 'feed', 'plunge', 'rpm']) {
    if (!Number.isFinite(profile[key]) || Math.abs(profile[key]) > 1000000) throw new Error(`Invalid tool profile ${key}.`);
  }
  if (profile.angle <= 0 || profile.angle >= 180 || profile.tip < 0 || profile.depth >= 0 ||
      profile.diameter <= 0 || profile.feed <= 0 || profile.plunge <= 0 || profile.rpm <= 0 || !Number.isSafeInteger(profile.rpm)) throw new Error('Invalid cutting parameters in tool profile.');
  if (typeof profile.measured !== 'boolean' || typeof profile.notes !== 'string' || profile.notes.length > 1000) throw new Error('Invalid tool profile measurement or notes.');
}
export function loadProfiles(storage) {
  try {
    const saved = JSON.parse(storage.getItem(TOOL_PROFILES_KEY) || '[]');
    if (!Array.isArray(saved) || saved.length > 200) return [];
    const seen = new Set();
    return saved.filter(profile => {
      try {
        validateProfile(profile);
        if (typeof profile.id !== 'string' || seen.has(profile.id)) return false;
        seen.add(profile.id); return true;
      } catch { return false; }
    });
  } catch { return []; }
}
let profiles = loadProfiles(globalThis.localStorage);
const listeners = new Set();
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
export const getToolProfiles = () => profiles;
export const useToolProfiles = () => useSyncExternalStore(subscribe, getToolProfiles);

export function profileFromTest({ name, notes = '', result, sample, diameter, measured = false }) {
  if (!result || toolTestErrors(result.settings).length || !result.samples.some(row => row.index === sample?.index && row.depth === sample.depth)) throw new Error('Choose a generated depth sample first.');
  sample = result.samples.find(row => row.index === sample.index);
  const profile = { name: typeof name === 'string' ? name.trim() : '', notes: notes.trim(), angle: sample.angle ?? result.settings.angle, tip: result.settings.tip,
    depth: sample.depth, diameter, feed: result.settings.feed, plunge: result.settings.plunge, rpm: result.settings.rpm,
    measured, test: { index: sample.index, settings: { ...result.settings } } };
  validateProfile(profile);
  return profile;
}
export function saveToolProfile(profile) {
  validateProfile(profile);
  const name = profile.name.trim();
  const existing = profiles.find(item => item.name.toLowerCase() === name.toLowerCase());
  if (!existing && profiles.length >= 200) throw new Error('Tool profile library is full (200 profiles).');
  const saved = structuredClone({ ...profile, name, id: existing?.id || globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, updatedAt: new Date().toISOString() });
  const next = existing ? profiles.map(item => item.id === existing.id ? saved : item) : [...profiles, saved];
  globalThis.localStorage.setItem(TOOL_PROFILES_KEY, JSON.stringify(next));
  profiles = next;
  listeners.forEach(listener => listener());
  return saved;
}
export function profileIsolationSettings(settings, profile) {
  validateProfile(profile);
  return { ...settings, isolation: { ...settings.isolation,
    depth: profile.depth, diameter: profile.diameter, feed: profile.feed, plunge: profile.plunge, rpm: profile.rpm,
    width: Math.max(settings.isolation.width, profile.diameter) } };
}
