// Verifies square-circle.nc parses to the expected geometry.
// Run: node --test test/patterns/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGcode, pathLength } from '../../src/jobs/parseGcode.js';

test('square-circle: 2 paths (square, circle), correct extents', () => {
  const gcode = readFileSync(new URL('./square-circle.nc', import.meta.url), 'utf8');
  const job = parseGcode(gcode);

  assert.equal(job.stats.paths, 2);

  const [square, circle] = job.paths;

  // square: plunge + 4 sides = 5 segments, all lines, closes at 0,0
  assert.equal(square.segments.length, 5);
  assert.ok(square.segments.every((s) => s.type === 'line'));
  const last = square.segments[square.segments.length - 1];
  assert.equal(last.end.x, 0);
  assert.equal(last.end.y, 0);

  // circle: plunge + 2 CCW arcs, each a half turn (sweep π), total 2π·r
  assert.equal(circle.segments.length, 3);
  const [a1, a2] = [circle.segments[1], circle.segments[2]];
  assert.equal(a1.type, 'arc');
  assert.equal(a2.type, 'arc');
  assert.equal(a1.clockwise, false);
  assert.equal(a2.clockwise, false);
  assert.equal(a1.center.x, 6);
  assert.equal(a1.center.y, 6);
  assert.equal(a2.center.x, 6); // I0 J-4 from (6,10): center (6,6)
  assert.equal(a2.center.y, 6);

  // combined cutting length: square 4×12 + 2 plunges (Z 3→-0.1 = 3.1 each) + circle 2π·4
  const totalCut = job.paths.reduce((n, p) => n + pathLength(p), 0);
  const expected = 4 * 12 + 2 * 3.1 + 2 * Math.PI * 4;
  assert.ok(Math.abs(totalCut - expected) < 0.01, `total=${totalCut} expected≈${expected}`);

  // bounds: square 0..12; circle adds nothing outside it
  assert.equal(job.bounds.min.x, 0);
  assert.equal(job.bounds.max.x, 12);
  assert.equal(job.bounds.min.y, 0);
  assert.equal(job.bounds.max.y, 12);
  assert.equal(job.bounds.min.z, -0.1);
  assert.equal(job.bounds.max.z, 3);
});
