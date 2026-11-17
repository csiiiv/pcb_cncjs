import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TOOL_TEST } from '../src/tooltest/config.js';
import { generateToolTest } from '../src/tooltest/generate.js';
import { DEFAULT_CAM_SETTINGS } from '../src/cam/defaults.js';
import { profileFromTest, profileIsolationSettings, saveToolProfile, loadProfiles, getToolProfiles } from '../src/tools/profiles.js';

const calibration = () => {
  const result = generateToolTest({ ...DEFAULT_TOOL_TEST, feed: 75, plunge: 35, rpm: 900 });
  return profileFromTest({ name: '60 deg / FR4', notes: '1 oz copper', result, sample: result.samples[4], diameter: 0.24, measured: true });
};
test('calibration records the generated settings and measured diameter at the chosen depth', () => {
  const profile = calibration();
  assert.equal(profile.angle, 60); assert.equal(profile.tip, 0.1);
  assert.equal(profile.depth, -0.1); assert.equal(profile.diameter, 0.24);
  assert.equal(profile.feed, 75); assert.equal(profile.measured, true);
  assert.equal(profile.test.index, 5); assert.equal(profile.notes, '1 oz copper');
});
test('applying a profile supplies isolation parameters and keeps clearance at least the tool width', () => {
  const original = structuredClone(DEFAULT_CAM_SETTINGS);
  original.isolation.width = 0.2;
  const settings = profileIsolationSettings(original, calibration());
  assert.deepEqual([settings.isolation.depth, settings.isolation.diameter, settings.isolation.feed, settings.isolation.plunge, settings.isolation.rpm], [-0.1, 0.24, 75, 35, 900]);
  assert.equal(settings.isolation.width, 0.24);
  assert.equal(original.isolation.width, 0.2);
  assert.deepEqual(settings.common, original.common);
});
test('profiles persist, update by name and reject invalid data without losing valid profiles', () => {
  const previous = globalThis.localStorage;
  const data = {};
  globalThis.localStorage = { getItem: key => data[key] ?? null, setItem: (key, value) => { data[key] = value; } };
  try {
    const first = saveToolProfile(calibration());
    assert.equal(loadProfiles(globalThis.localStorage).length, 1);
    assert.equal(loadProfiles(globalThis.localStorage)[0].diameter, 0.24);
    const updated = saveToolProfile({ ...calibration(), name: '60 DEG / FR4', diameter: 0.25 });
    assert.equal(updated.id, first.id); assert.equal(getToolProfiles().length, 1);
    assert.equal(loadProfiles(globalThis.localStorage)[0].diameter, 0.25);
    assert.throws(() => saveToolProfile({ ...calibration(), diameter: -1 }));
    const snapshot = getToolProfiles();
    globalThis.localStorage = { setItem: () => { throw new Error('Storage blocked'); } };
    assert.throws(() => saveToolProfile(calibration()), /Storage blocked/);
    assert.equal(getToolProfiles(), snapshot);
    assert.deepEqual(loadProfiles({ getItem: () => '{bad json' }), []);
  } finally { globalThis.localStorage = previous; }
});

test('angle comparison saves the chosen hypothesis instead of the unused single angle setting', () => {
  const result = generateToolTest({ ...DEFAULT_TOOL_TEST, pattern: 'angles', tip: 0.2, angle: 60 });
  const sample = result.samples.find(row => row.angle === 15 && row.depth === -0.04);
  const profile = profileFromTest({ name: '15 degree hypothesis', result, sample, diameter: sample.width });
  assert.equal(profile.angle, 15);
  assert.equal(profile.tip, 0.2);
  assert.equal(profile.depth, -0.04);
  assert.equal(profile.measured, false);
});
