// End-of-job park programs. Built-ins are fixed; custom programs persist in
// localStorage and show up in the same dropdown. Spindle stop (M5) is sent
// by the park step itself, ahead of whichever program is selected.
const CUSTOM_KEY = 'pcb-cnc.park-custom.v1';
const LAST_KEY = 'pcb-cnc.park-last.v1';

export const BUILTIN_PARK = [
  {
    id: 'rise-xy0',
    name: 'Rise 2 mm, then XY zero',
    gcode: 'G21\nG91\nG0 Z2\nG90\nG0 X0 Y0'
  },
  {
    id: 'rise',
    name: 'Just rise 2 mm',
    gcode: 'G21\nG91\nG0 Z2\nG90'
  }
];

export const NEW_PARK_ID = '__new__';

/** Non-empty program lines, comments and blanks removed. */
export function parkLines(gcode) {
  return String(gcode || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\(.*?\)/g, '').replace(/;.*$/, '').trim())
    .filter(Boolean);
}

export function loadCustomPark() {
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string' && parkLines(item.gcode).length)
      .map((item) => ({
        id: String(item.id).slice(0, 40),
        name: String(item.name).slice(0, 80),
        gcode: String(item.gcode).slice(0, 2000),
        custom: true
      }));
  } catch {
    return [];
  }
}

export function saveCustomPark(list) {
  const clean = (list || []).filter((item) => item?.custom && item.name && parkLines(item.gcode).length)
    .map((item) => ({ id: item.id, name: item.name, gcode: item.gcode }));
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(clean));
  return clean;
}

export function loadLastParkId() {
  try { return localStorage.getItem(LAST_KEY) || BUILTIN_PARK[0].id; }
  catch { return BUILTIN_PARK[0].id; }
}

export function saveLastParkId(id) {
  try { localStorage.setItem(LAST_KEY, id); } catch { /* private mode */ }
}
