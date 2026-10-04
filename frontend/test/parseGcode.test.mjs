// Parser unit tests for the structured job model (brief §15–16).
// Run: node --test test/parseGcode.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGcode, pathLength } from '../src/jobs/parseGcode.js';

test('parses lines, paths, arcs and rapids from the test pattern', () => {
  const gcode = readFileSync(new URL('./patterns/simple-pattern.nc', import.meta.url), 'utf8');
  const job = parseGcode(gcode);

  // 3 logical cutting paths: rectangle, line+arc, circle
  assert.equal(job.stats.paths, 3);
  // segments: rect 4 + plunge-line? (plunge is G1 Z → 1 line) … verify counts explicitly below
  const [rect, lineArc, circle] = job.paths;

  // Path 1: plunge (Z) + 4 rectangle sides
  assert.equal(rect.segments.length, 5);
  assert.equal(rect.segments[0].motion, 'G1');
  assert.equal(rect.segments[1].end.x, 10);

  // Path 2: plunge + line + arc (IJ form, CCW? G2 = CW) + line
  assert.equal(lineArc.segments.length, 4);
  const arc = lineArc.segments[2];
  assert.equal(arc.type, 'arc');
  assert.equal(arc.clockwise, true);
  assert.ok(arc.center);
  // center = start (25,0) + (I0,J2) = (25,2); radius 2
  assert.equal(arc.center.x, 25);
  assert.equal(arc.center.y, 2);
  assert.equal(arc.radius, 2);

  // Path 3: plunge + full circle
  assert.equal(circle.segments.length, 2);
  assert.equal(circle.segments[1].type, 'arc');

  // Rapids recorded with source lines
  assert.ok(job.stats.rapids >= 6);
  assert.ok(job.rapidMoves.every((r) => r.sourceLine > 0));
});

test('relative distance mode (G91) accumulates positions', () => {
  const job = parseGcode('G91\nG1 X5\nG1 X5\n');
  const p = job.paths[0];
  assert.equal(p.segments.length, 2);
  assert.equal(p.segments[1].end.x, 10);
});

test('comments are ignored and source lines are tracked', () => {
  const job = parseGcode('; hi\nG1 X1 (mid comment)\n\nG1 X2 ; tail\n');
  const segs = job.paths[0].segments;
  assert.equal(segs.length, 2);
  assert.equal(segs[0].sourceLine, 2);
  assert.equal(segs[1].sourceLine, 4);
});

test('bounds reflect geometry extents', () => {
  const job = parseGcode('G0 X5 Y5\nG1 X10 Y10\n');
  assert.equal(job.bounds.max.x, 10);
  assert.equal(job.bounds.max.y, 10);
  assert.equal(job.bounds.min.x, 0); // start position included
});

test('pathLength: square sides sum (no plunge in snippet)', () => {
  const job = parseGcode('G1 X10 Y0\nG1 X10 Y10\n');
  const len = pathLength(job.paths[0]);
  assert.equal(len, 20);
});

test('pathLength: CW 270° arc (bottom→right of r=2 circle) = 3π', () => {
  // start (25,0) is bottom of circle centered (25,2); end (27,2) is right.
  // Clockwise: bottom → left → top → right = 270°.
  const job = parseGcode('G1 X25 Y0\nG2 X27 Y2 I0 J2\n');
  const arc = job.paths[0].segments[1];
  const len = pathLength({ segments: [arc] });
  assert.ok(Math.abs(len - 3 * Math.PI) < 1e-6, `len=${len}`);
});

test('pathLength: true semicircle (CW through bottom) = π·r', () => {
  // start (27,0), center (25,0), end (23,0): CW sweep = 180°
  const job = parseGcode('G1 X27 Y0\nG2 X23 Y0 I-2 J0\n');
  const arc = job.paths[0].segments[1];
  const len = pathLength({ segments: [arc] });
  assert.ok(Math.abs(len - Math.PI * 2) < 1e-6, `len=${len}`);
});
