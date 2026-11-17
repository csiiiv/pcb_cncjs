import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TOOL_TEST, grooveWidth, toolTestErrors } from '../src/tooltest/config.js';
import { generateToolTest } from '../src/tooltest/generate.js';
import { parseGcode } from '../src/jobs/parseGcode.js';

test('60-degree V-bit widths use the included half-angle and tip diameter', () => {
  assert.equal(grooveWidth(60, 0.1, 0), 0.1);
  assert.ok(Math.abs(grooveWidth(60, 0.1, -0.1) - 0.2154700538) < 1e-9);
  assert.ok(Math.abs(grooveWidth(90, 0, -0.1) - 0.2) < 1e-9);
});

test('depth sweep creates independent grooves, retracting before every XY rapid', () => {
  const settings = { ...DEFAULT_TOOL_TEST, pattern: 'grooves', length: 15, pitch: 1, startX: 4, startY: 7 };
  const result = generateToolTest(settings);
  settings.angle = 90;
  assert.equal(result.settings.angle, 60);
  assert.equal(result.samples.length, 10);
  const job = parseGcode(result.gcode);
  assert.equal(job.paths.length, 10);
  const cuts = job.paths.flatMap(path => path.segments).filter(seg => seg.start.x !== seg.end.x);
  assert.equal(cuts.length, 10);
  cuts.forEach((seg, i) => {
    assert.equal(seg.start.x, 4); assert.equal(seg.end.x, 19);
    assert.equal(seg.start.y, 7 + i); assert.equal(seg.end.y, 7 + i);
    assert.equal(seg.start.z, result.samples[i].depth); assert.equal(seg.end.z, seg.start.z);
  });
  for (const move of job.rapidMoves) {
    if (move.start.x !== move.end.x || move.start.y !== move.end.y) {
      assert.equal(move.start.z, 3); assert.equal(move.end.z, 3);
    }
  }
  assert.ok(result.gcode.startsWith('(V-bit'));
  assert.ok(result.gcode.includes('G21\nG90\nG17\nG54\nG94\nM5\nG0 Z3'));
  assert.ok(result.gcode.endsWith('G0 Z3\nM5\nM2\n'));
  assert.ok(!/G10|G28|G53|G91\b/.test(result.gcode));
});

test('non-divisible ranges include the deepest endpoint without cutting beyond it', () => {
  const result = generateToolTest({ ...DEFAULT_TOOL_TEST, pattern: 'grooves', firstDepth: -0.02, lastDepth: -0.18, depthStep: 0.07 });
  assert.deepEqual(result.samples.map(row => row.depth), [-0.02, -0.09, -0.16, -0.18]);
  assert.equal(generateToolTest({ ...DEFAULT_TOOL_TEST, pattern: 'grooves', firstDepth: -0.1, lastDepth: -0.1 }).samples.length, 1);
});

test('invalid profiles, inverted ranges, overlapping grooves and excessive samples are blocked', () => {
  for (const patch of [{ angle: 180 }, { tip: -1 }, { firstDepth: 0 }, { lastDepth: -0.01 }, { depthStep: 0 }, { pitch: 0.1 }, { safeZ: 0 }, { feed: 0 }, { rpm: 5.5 }, { depthStep: 0.001 }, { firstDepth: NaN }]) {
    const settings = { ...DEFAULT_TOOL_TEST, ...patch };
    assert.ok(toolTestErrors(settings).length, JSON.stringify(patch));
    assert.throws(() => generateToolTest(settings));
  }
});

test('trace coupon preserves nominal copper widths in every depth section', () => {
  const result = generateToolTest(DEFAULT_TOOL_TEST);
  assert.deepEqual(result.traces.map(trace => trace.width), [0.127, 0.254, 0.381, 0.508]);
  assert.equal(result.samples.length, 10);
  assert.equal(result.cuts.filter(cut => cut.kind === 'trace').length, 80);
  for (const sample of result.samples) {
    const cuts = result.cuts.filter(cut => cut.kind === 'trace' && cut.x === sample.x);
    result.traces.forEach((trace, index) => {
      const lower = cuts[index * 2], upper = cuts[index * 2 + 1];
      assert.equal(lower.depth, sample.depth); assert.equal(upper.depth, sample.depth);
      assert.ok(Math.abs(upper.y - lower.y - sample.width - trace.width) < 0.000002);
      assert.equal(lower.endX, sample.xEnd);
    });
  }
  const ticks = result.cuts.filter(cut => cut.kind === 'tick');
  assert.equal(ticks.length, 11);
  assert.equal(ticks[0].x, 0); assert.equal(ticks.at(-1).x, 30);
  assert.ok(ticks.every(tick => tick.depth === DEFAULT_TOOL_TEST.markerDepth));
  assert.ok(ticks[5].endY - ticks[5].y > ticks[4].endY - ticks[4].y);
  assert.equal(result.cuts.filter(cut => cut.kind === 'reference').length, 10);
  const job = parseGcode(result.gcode);
  assert.equal(job.paths.length, 101);
  for (const move of job.rapidMoves) {
    if (move.start.x !== move.end.x || move.start.y !== move.end.y) {
      assert.equal(move.start.z, DEFAULT_TOOL_TEST.safeZ);
      assert.equal(move.end.z, DEFAULT_TOOL_TEST.safeZ);
    }
  }
});

test('angle comparison targets 10 mil at each hypothesized angle and depth with safe travel', () => {
  const result = generateToolTest({ ...DEFAULT_TOOL_TEST, pattern: 'angles', tip: 0.2, angle: 120 });
  assert.deepEqual(result.traces.map(trace => trace.angle), [15, 30, 45, 60, 75, 90]);
  assert.ok(result.traces.every(trace => trace.width === 0.254));
  assert.equal(result.samples.length, 60);
  assert.equal(new Set(result.samples.map(sample => sample.index)).size, 60);
  const cuts = result.cuts.filter(cut => cut.kind === 'trace');
  assert.equal(cuts.length, 120);
  result.samples.forEach((sample, index) => {
    const [lower, upper] = cuts.slice(index * 2, index * 2 + 2);
    assert.equal(sample.width, grooveWidth(sample.angle, 0.2, sample.depth));
    assert.ok(Math.abs(upper.y - lower.y - sample.width - 0.254) < 0.000002);
    assert.ok(Math.abs((upper.y + lower.y) / 2 - sample.y) < 0.000002);
    assert.equal(lower.depth, sample.depth);
    assert.equal(lower.x, sample.x); assert.equal(upper.endX, sample.xEnd);
  });
  assert.equal(result.cuts.filter(cut => cut.kind === 'reference').length, 0);
  assert.equal(result.cuts.filter(cut => cut.kind === 'tick').length, 11);
  assert.equal(result.filename, 'v-bit-angle-comparison.ngc');
  const job = parseGcode(result.gcode);
  assert.equal(job.paths.length, 131);
  for (const move of job.rapidMoves) {
    if (move.start.x !== move.end.x || move.start.y !== move.end.y) {
      assert.equal(move.start.z, 3); assert.equal(move.end.z, 3);
    }
  }
});

test('angle comparison spacing uses the widest hypothesis rather than the single angle setting', () => {
  const settings = { ...DEFAULT_TOOL_TEST, pattern: 'angles', angle: 15, tip: 0.2 };
  assert.ok(toolTestErrors({ ...settings, pitch: 1.3 }).some(error => error.includes('Trace spacing')));
  assert.ok(toolTestErrors({ ...settings, markerDepth: -0.11 }).some(error => error.includes('Tick grooves')));
  assert.ok(toolTestErrors({ ...settings, length: 10 }).some(error => error.includes('Depth sections')));
  const result = generateToolTest({ ...settings, lastDepth: -0.18, depthStep: 0.07 });
  assert.deepEqual([...new Set(result.samples.map(sample => sample.depth))], [-0.02, -0.09, -0.16, -0.18]);
});
