import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeNextStep } from '../src/workflow.js';
import { hullCoversBounds } from '../src/probe/mesh.js';
import { toast, dismissToast, getToasts } from '../src/ui/toast.js';

const BASE = { serverConnected: true, port: '/dev/ttyUSB0', hasJob: true, senderReady: true };

test('workflow guide walks the full machining flow', () => {
  assert.deepEqual(
    computeNextStep({}),
    { label: 'Connect CNCjs server', widget: 'connection' }
  );
  assert.deepEqual(
    computeNextStep({ serverConnected: true }),
    { label: 'Open machine port', widget: 'connection' }
  );
  assert.deepEqual(
    computeNextStep({ ...BASE, hasJob: false }),
    { label: 'Import CAM or load G-code', widget: 'cam' }
  );
  assert.deepEqual(
    computeNextStep({ ...BASE, hasJob: true, compensationPending: true }),
    { label: 'Probe surface ready — apply compensation?', widget: 'autolevel' }
  );
  assert.deepEqual(
    computeNextStep({ ...BASE, senderReady: false }),
    { label: 'Load job into sender', widget: 'runner' }
  );
  assert.deepEqual(
    computeNextStep(BASE),
    { label: 'Pre-flight check, then Start', widget: 'runner' }
  );
});

test('workflow guide reflects running and paused jobs', () => {
  assert.deepEqual(
    computeNextStep({ ...BASE, jobRunning: true }),
    { label: 'Job running', widget: 'runner' }
  );
  assert.deepEqual(
    computeNextStep({ ...BASE, jobRunning: true, paused: true }),
    { label: 'Job paused — resume in Job Runner', widget: 'runner' }
  );
  assert.deepEqual(
    computeNextStep({ ...BASE, machineBusy: true, stateLabel: 'Jog' }),
    { label: 'Machine busy (Jog)', widget: 'runner' }
  );
  // jogging is machine-busy, not a job run
  assert.deepEqual(
    computeNextStep({ ...BASE, machineBusy: true }),
    { label: 'Machine busy (moving)', widget: 'runner' }
  );
});

test('hull coverage detects an undersized probe mesh before probing', () => {
  // 5x5 lattice covering [0,50]^2, job corners inside
  const inside = [];
  for (let x = 0; x <= 50; x += 12.5) {
    for (let y = 0; y <= 50; y += 12.5) inside.push({ id: `v${x}-${y}`, x, y });
  }
  const covered = hullCoversBounds(inside, { minX: 5, maxX: 45, minY: 5, maxY: 45 });
  assert.equal(covered.covered, true);
  assert.equal(covered.missing.length, 0);

  // job extends past the hull on +X: corners outside must be reported
  const overhang = hullCoversBounds(inside, { minX: 5, maxX: 60, minY: 5, maxY: 45 });
  assert.equal(overhang.covered, false);
  assert.ok(overhang.missing.some((c) => c.x === 60));

  // no vertices / no bounds: never claim coverage
  assert.equal(hullCoversBounds([], { minX: 0, maxX: 1, minY: 0, maxY: 1 }).covered, false);
  assert.equal(hullCoversBounds(inside, null).covered, false);
});

test('toast store appends and dismisses transient messages', () => {
  const before = getToasts().length;
  const id = toast('X0 set in G54');
  assert.equal(getToasts().length, before + 1);
  assert.equal(getToasts().at(-1).message, 'X0 set in G54');
  assert.equal(getToasts().at(-1).kind, 'info');
  dismissToast(id);
  assert.equal(getToasts().length, before);
  // dismissing twice is harmless
  dismissToast(id);
  assert.equal(getToasts().length, before);
});
