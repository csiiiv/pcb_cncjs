import { test } from 'node:test';
import assert from 'node:assert/strict';
import { camSetupSteps, camStepErrors } from '../src/cam/setup.js';
import { DEFAULT_CAM_SETTINGS } from '../src/cam/store.js';
const settings = () => structuredClone(DEFAULT_CAM_SETTINGS);

test('guided setup only includes operations with source files', () => {
  assert.deepEqual(camSetupSteps({ drill: {} }).map(s => s.id), ['files', 'common', 'drilling', 'review', 'results']);
  assert.deepEqual(camSetupSteps({ outline: {}, front: {}, drill: {} }).map(s => s.id), ['files', 'common', 'isolation', 'drilling', 'outline', 'review', 'results']);
  assert.ok(camStepErrors('review', {}, settings()).length);
  assert.deepEqual(camStepErrors('review', { drill: {} }, settings()), []);
});

test('review validates board clearance and selected operations only', () => {
  const s = settings();
  s.isolation.feed = -1;
  assert.deepEqual(camStepErrors('review', { drill: {} }, s), []);
  assert.ok(camStepErrors('review', { front: {} }, s).some(e => e.includes('Feed')));
  s.common.changeZ = 1;
  assert.ok(camStepErrors('common', {}, s).some(e => e.includes('Tool-change')));
  s.common.safeZ = NaN;
  assert.ok(camStepErrors('common', {}, s).some(e => e.includes('safe z')));
});

test('outline tabs must remain above the cut with a whole positive count', () => {
  const s = settings();
  s.outline.bridgeZ = s.outline.depth;
  assert.ok(camStepErrors('outline', {}, s).some(e => e.includes('Tabs need')));
  s.outline.bridges = 0;
  assert.deepEqual(camStepErrors('outline', {}, s), []);
  s.outline.bridgeCount = 1.5;
  assert.ok(camStepErrors('outline', {}, s).some(e => e.includes('whole number')));
});
