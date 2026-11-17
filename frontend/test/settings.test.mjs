import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FACTORY_DEFAULTS, settingsErrors } from '../src/settings/schema.js';
import { loadDefaults, saveDefaults, getAllDefaults, SETTINGS_KEY } from '../src/settings/store.js';
const storage = (data = {}) => ({ getItem: key => data[key] ?? null, setItem: (key, value) => { data[key] = value; } });

test('default migration retains CAM, spindle and viewer preferences', () => {
  const values = loadDefaults(storage({
    'pcb-cnc.cam.settings.v1': JSON.stringify({ drilling: { feed: 92 } }),
    'pcb-cnc-spindle-rpm': '850',
    'pcb-cnc.viz.prefs.v1': JSON.stringify({ colormap: 'viridis', layers: { grid: false } })
  }));
  assert.equal(values.cam.drilling.feed, 92);
  assert.equal(values.cam.common.safeZ, 3);
  assert.equal(values.spindle.rpm, 850);
  assert.equal(values.visualizer.layers.grid, false);
  assert.equal(values.visualizer.layers.toolpaths, true);
});

test('saved defaults override legacy values and reject invalid saved sections', () => {
  const values = loadDefaults(storage({ [SETTINGS_KEY]: JSON.stringify({ spindle: { rpm: 500 }, probe: { depth: -1 }, gcode: { followRun: false } }), 'pcb-cnc-spindle-rpm': '900' }));
  assert.equal(values.spindle.rpm, 500);
  assert.equal(values.probe.depth, FACTORY_DEFAULTS.probe.depth);
  assert.equal(values.gcode.followRun, false);
  assert.deepEqual(loadDefaults(storage({ [SETTINGS_KEY]: '{bad json' })), FACTORY_DEFAULTS);
});

test('validation checks CAM and autolevel relationships and connection URLs', () => {
  assert.deepEqual(settingsErrors(FACTORY_DEFAULTS), []);
  const values = structuredClone(FACTORY_DEFAULTS);
  values.cam.common.changeZ = 1;
  values.autolevel.endZ = 5;
  values.connection.serverUrl = 'javascript:alert(1)';
  values.spindle.rpm = 2.5;
  const errors = settingsErrors(values);
  assert.ok(errors.some(e => e.includes('Tool-change')));
  assert.ok(errors.some(e => e.includes('Autolevel')));
  assert.ok(errors.some(e => e.includes('HTTP')));
  assert.ok(errors.some(e => e.includes('Spindle')));
  assert.ok(settingsErrors({}).length);
});

test('saving round-trips defaults and returns independent copies', () => {
  const original = globalThis.localStorage;
  globalThis.localStorage = storage();
  try {
    const values = structuredClone(FACTORY_DEFAULTS);
    values.controls.feedXY = 220;
    values.probe.depth = 6;
    saveDefaults(values);
    assert.equal(loadDefaults(globalThis.localStorage).controls.feedXY, 220);
    values.probe.depth = 99;
    const copy = getAllDefaults(); copy.probe.depth = 100;
    assert.equal(getAllDefaults().probe.depth, 6);
    assert.throws(() => saveDefaults({ ...values, spindle: { rpm: -5 } }), /Spindle/);
    globalThis.localStorage = { setItem: () => { throw new Error('Storage blocked'); } };
    assert.throws(() => saveDefaults(FACTORY_DEFAULTS), /Storage blocked/);
    assert.equal(getAllDefaults().controls.feedXY, 220);
  } finally { globalThis.localStorage = original; }
});


test('older Tool Test defaults retain their separate-groove pattern and custom parameters', () => {
  const values = loadDefaults(storage({ [SETTINGS_KEY]: JSON.stringify({ tooltest: { angle: 45, pitch: 1, length: 15, feed: 80 } }) }));
  assert.equal(values.tooltest.pattern, 'grooves');
  assert.equal(values.tooltest.angle, 45);
  assert.equal(values.tooltest.feed, 80);
  assert.equal(values.tooltest.pitch, 1);
});
