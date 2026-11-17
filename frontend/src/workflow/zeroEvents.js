// Pure parsing of machine zeroing events from CNCjs socket traffic.
// The session reconciler uses these to mark stages done from *real* machine
// activity instead of UI claims (workflow.md §6: session is the diary,
// machine is reality).
//
// G10 L20 (set work coordinate offset) is sent via 'gcode' commands and
// echoed through serialport:write; PRB reports arrive on serialport:read.

/**
 * Parse a serialport:write line for a G10 L20 work-zeroing command.
 * Returns { axes: ['X','Y'], wcs: 'G54' } or null.
 *
 *   'G10 L20 P1 X0 Y0'   → { axes: ['X','Y'], wcs: 'G54' }
 *   'G10 L20 P1 Z5.000'  → { axes: ['Z'], wcs: 'G54', plate: 5 }
 */
export function parseZeroWrite(line) {
  if (typeof line !== 'string') return null;
  // strip inline comments
  const text = line.replace(/\([^)]*\)/g, ' ').trim();
  if (!/^G10\s+L20/i.test(text)) return null;
  const p = /\bP([1-6])\b/i.exec(text);
  const wcs = p ? `G5${Number(p[1]) + 3}` : 'G54'; // P1→G54 … P5→G58, P6→G59
  const axes = [];
  let plate = null; // only meaningful for Z (touch-probe plate thickness)
  const re = /\b([XYZ])(-?\d*\.?\d+)\b/g;
  let m;
  while ((m = re.exec(text))) {
    if (!axes.includes(m[1])) axes.push(m[1]);
    if (m[1] === 'Z') plate = Number(m[2]);
  }
  if (!axes.length) return null;
  return { axes, wcs, plate };
}

/** True when a write event covers both X and Y zeroing (mount + zero XY done). */
export function zeroWriteCoversXY(info) {
  return Boolean(info && info.wcs === 'G54' && info.axes.includes('X') && info.axes.includes('Y'));
}

/** True when a write event zeroes Z in G54 (zeroedZ stage evidence). */
export function zeroWriteCoversZ(info) {
  return Boolean(info && info.wcs === 'G54' && info.axes.includes('Z'));
}
