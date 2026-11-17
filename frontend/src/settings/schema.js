import { DEFAULT_TOOL_TEST, TOOL_TEST_FIELDS, toolTestErrors, TOOL_TEST_PATTERNS } from '../tooltest/config.js';
import { parameterHelp } from '../ui/parameterHelp.js';
import { DEFAULT_CAM_SETTINGS } from '../cam/defaults.js';
import { CAM_FIELDS, camStepErrors } from '../cam/setup.js';
import { VIEWER_LAYERS } from '../visualizer/layers.js';
import { COLORMAPS } from '../probe/colormap.js';

const number = (key, label, min, max = 1000000, integer = false) => ({ key, label, type: 'number', min, max, integer });
const check = (key, label) => ({ key, label, type: 'boolean' });
const select = (key, label, options) => ({ key, label, type: 'select', options: options.map(value => typeof value === 'string' ? [value, value] : value) });
export const SETTINGS_TABS = [
  { id: 'connection', title: 'Connection', fields: [
    { key: 'serverUrl', label: 'CNCjs server URL (blank for this server)', type: 'text' },
    { key: 'preferredPort', label: 'Preferred machine port', type: 'text' },
    number('baudrate', 'Baud rate', 1, 4000000, true),
    check('autoConnect', 'Auto-connect machine on load')
  ] },
  { id: 'dro', title: 'DRO', fields: [number('decimals', 'Coordinate decimal places', 0, 6, true), check('showMachine', 'Show machine position')] },
  { id: 'status', title: 'Status', fields: [check('showDetails', 'Show detailed status rows')] },
  { id: 'controls', title: 'Machine Controls', fields: [select('increment', 'Jog step (mm)', [0.01, 0.1, 1, 10].map(n => [n, String(n)])), number('feedXY', 'XY jog feed (mm/min)', 0.001), number('feedZ', 'Z jog feed (mm/min)', 0.001)] },
  { id: 'spindle', title: 'Spindle', fields: [number('rpm', 'Spindle speed (RPM)', 0, 1000000, true)] },
  { id: 'cam', title: 'PCB CAM', groups: Object.entries(CAM_FIELDS).map(([section, fields]) => ({
    title: { common: 'Board setup', isolation: 'Isolation', drilling: 'Drilling', outline: 'Outline' }[section],
    fields: [...fields.map(([key, label]) => number(`${section}.${key}`, label, -1000000)),
      ...(section === 'common' ? [check('common.zeroStart', 'Place board lower-left at work XY0')] : [])]
  })) },
  { id: 'tooltest', title: 'Tool Test', fields: [select('pattern', 'Test pattern', TOOL_TEST_PATTERNS), ...TOOL_TEST_FIELDS.map(([key, label]) => number(key, label, -1000000))] },
  { id: 'visualizer', title: 'Toolpath', fields: [
    select('view', 'Initial view', ['top', 'left', 'right', 'iso']),
    select('colormap', 'Heightmap palette', Object.entries(COLORMAPS).map(([id, data]) => [id, data.label])),
    ...VIEWER_LAYERS.map(layer => check(layer.pref || `layers.${layer.id}`, layer.label))
  ] },
  { id: 'gcode', title: 'G-code', fields: [check('followSelection', 'Follow toolpath selection'), check('followRun', 'Follow running line')] },
  { id: 'runner', title: 'Job Runner', fields: [], help: 'Job Runner has no configurable defaults. Load an operation and use its Start controls to run it.' },
  { id: 'probe', title: 'Probe', fields: [check('confirmWiring', 'Confirm probe wiring before probing'), select('axis', 'Axis', ['Z', 'X', 'Y']), select('command', 'Probe command', ['G38.2', 'G38.3', 'G38.4', 'G38.5']), number('depth', 'Travel depth (mm)', 0.001), number('feedrate', 'Feed (mm/min)', 1), number('plate', 'Plate thickness (mm)', 0), number('retract', 'Retract (mm)', 0)] },
  { id: 'autolevel', title: 'Autolevel', fields: [number('clearanceZ', 'Clearance Z (mm)', 0.001), number('startZ', 'Probe start Z (mm)', -1000000), number('endZ', 'Probe end Z (mm)', -1000000), number('feedrate', 'Probe feed (mm/min)', 1), number('minX', 'Min X (mm)', -1000000), number('maxX', 'Max X (mm)', -1000000), number('minY', 'Min Y (mm)', -1000000), number('maxY', 'Max Y (mm)', -1000000), number('spacing', 'Point spacing (mm)', 0.001), number('margin', 'Margin (mm)', 0), number('attempts', 'Repeatability attempts', 2, 100, true), select('mode', 'Repeatability mode', ['burst', 'cycled'])] },
  { id: 'console', title: 'Console', fields: [check('autoscroll', 'Autoscroll serial traffic'), check('hideStatus', 'Hide GRBL status reports')] }
];

for (const tab of SETTINGS_TABS) {
  for (const field of tab.fields || tab.groups.flatMap(group => group.fields)) field.help = parameterHelp(tab.id, field.key);
}

export const FACTORY_DEFAULTS = {
  connection: { serverUrl: '', preferredPort: '', baudrate: 115200, autoConnect: false },
  dro: { decimals: 3, showMachine: true }, status: { showDetails: true },
  controls: { increment: 1, feedXY: 500, feedZ: 100 }, spindle: { rpm: 1000 },
  cam: DEFAULT_CAM_SETTINGS, tooltest: DEFAULT_TOOL_TEST,
  visualizer: { view: 'iso', colormap: 'blue-red', showZLabels: false, showTravel: false,
    layers: Object.fromEntries(VIEWER_LAYERS.filter(layer => !layer.pref).map(layer => [layer.id, layer.id !== 'swath'])) },
  gcode: { followSelection: true, followRun: true }, runner: {},
  probe: { axis: 'Z', command: 'G38.2', depth: 10, feedrate: 50, plate: 0, retract: 2, confirmWiring: true },
  autolevel: { clearanceZ: 3, startZ: 1, endZ: -2, feedrate: 50, minX: 0, maxX: 50, minY: 0, maxY: 50, spacing: 10, margin: 2, attempts: 5, mode: 'burst' },
  console: { autoscroll: true, hideStatus: true }
};
export const getPath = (object, path) => path.split('.').reduce((value, key) => value?.[key], object);
export function setPath(object, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let target = object;
  for (const key of keys) target = target[key];
  target[last] = value;
}
export function settingsErrors(values, section) {
  const tabs = SETTINGS_TABS.filter(tab => !section || tab.id === section);
  const errors = [];
  for (const tab of tabs) {
    const data = values?.[tab.id];
    const before = errors.length;
    const fields = tab.fields || tab.groups.flatMap(group => group.fields);
    for (const field of fields) {
      const value = getPath(data, field.key);
      let valid = true;
      if (field.type === 'number') valid = Number.isFinite(value) && value >= field.min && value <= field.max && (!field.integer || Number.isSafeInteger(value));
      if (field.type === 'boolean') valid = typeof value === 'boolean';
      if (field.type === 'text') valid = typeof value === 'string';
      if (field.type === 'select') valid = field.options.some(([option]) => option === value);
      if (!valid) errors.push(`${tab.title}: enter a valid ${field.label.toLowerCase()}.`);
    }
    if (!data || errors.length > before) continue;
    if (tab.id === 'connection' && typeof data.serverUrl === 'string' && data.serverUrl) {
      try { const url = new URL(data.serverUrl); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error(); }
      catch { errors.push('Connection: enter an HTTP or HTTPS server URL.'); }
    }
    if (tab.id === 'cam') errors.push(...camStepErrors('review', { front: {}, drill: {}, outline: {} }, data).map(error => `PCB CAM: ${error}`));
    if (tab.id === 'tooltest') errors.push(...toolTestErrors(data).map(error => `Tool Test: ${error}`));
    if (tab.id === 'autolevel') {
      if (!(data.endZ < data.startZ && data.startZ <= data.clearanceZ)) errors.push('Autolevel: end Z must be below start Z, and start Z no higher than clearance Z.');
      if (!(data.minX < data.maxX && data.minY < data.maxY)) errors.push('Autolevel: maximum bounds must exceed minimum bounds.');
    }
  }
  return errors;
}
