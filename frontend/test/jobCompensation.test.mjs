import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGcode } from '../src/jobs/parseGcode.js';
import { viz, setViz } from '../src/visualizer/vizStore.js';
import { applyJobCompensation, revertJobCompensation, showNominalPreview, showCompensatedPreview } from '../src/visualizer/jobCompensation.js';

const text = 'G21\nG90\nG0 Z3\nG0 X1 Y1\nG1 Z-0.08 F40\nG1 X5 Y1 F120\nG0 Z3\nM5\n';
const makeJob = (name = 'front.ngc') => ({ ...parseGcode(text), text, name,
  operationId: 'front', tool: '0.2 mm bit', nominal: true });
const surface = (offset) => ({ triangleCount: 1, getZ: () => offset });

test('reapplying compensation uses the original and preserves metadata and source', () => {
  const original = makeJob();
  const before = JSON.stringify(original);
  setViz({ job: original });
  const first = applyJobCompensation(surface(0.02));
  assert.ok(Math.abs(first.paths[0].segments[0].end.z - (-0.06)) < 1e-9);
  const second = applyJobCompensation(surface(0.02));
  assert.equal(second.text, first.text);
  assert.equal(second.name, 'front.ngc (compensated)');
  const updated = applyJobCompensation(surface(0.04));
  assert.ok(Math.abs(updated.paths[0].segments[0].end.z - (-0.04)) < 1e-9);
  assert.equal(updated.operationId, original.operationId);
  assert.equal(updated.paths[0].tool, original.tool);
  assert.equal(viz.nominalJob, original);
  assert.equal(JSON.stringify(original), before);
  setViz({ job: null });
});

test('reverting restores the exact original and redraws both job and rapids', () => {
  const drawn = [];
  const original = makeJob();
  setViz({ scene: {
    setJob: (job) => drawn.push(job), setRapids: (moves) => drawn.push(moves),
    setPreviewCursor: () => {}
  }, job: original });
  applyJobCompensation(surface(0.02));
  setViz({ selection: { pathId: 1 } });
  revertJobCompensation();
  assert.equal(viz.job, original);
  assert.equal(viz.job.text, text);
  assert.equal(viz.compensatedJob, null);
  assert.equal(viz.selection, null);
  assert.equal(drawn.at(-2), original);
  assert.equal(drawn.at(-1), original.rapidMoves);
  setViz({ scene: null, job: null });
});

test('coverage failures leave the active compensated job and original untouched', () => {
  setViz({ job: makeJob() });
  const active = applyJobCompensation(surface(0.02));
  const original = viz.nominalJob;
  assert.throws(() => applyJobCompensation({ triangleCount: 1, getZ: () => null }), /outside the probed surface/);
  assert.equal(viz.job, active);
  assert.equal(viz.nominalJob, original);
  assert.throws(() => applyJobCompensation({ triangleCount: 0 }), /no measured surface/);
  setViz({ job: null });
});

test('switching preview between raw and compensated keeps both copies', () => {
  const original = makeJob();
  setViz({ job: original });
  const compensated = applyJobCompensation(surface(0.02));
  showNominalPreview();
  assert.equal(viz.job, original);
  assert.equal(viz.job.nominal, true);
  assert.equal(viz.compensatedJob, compensated);
  showCompensatedPreview();
  assert.equal(viz.job, compensated);
  assert.equal(viz.job.nominal, false);
  assert.equal(viz.nominalJob, original);
  assert.equal(viz.compensatedJob, compensated);
  setViz({ job: null });
});

test('loading another file or CAM operation resets compensation to the new original', () => {
  setViz({ job: makeJob() });
  applyJobCompensation(surface(0.02));
  const next = makeJob('outline.ngc');
  setViz({ job: next });
  assert.equal(viz.nominalJob, next);
  assert.equal(viz.compensatedJob, null);
  revertJobCompensation();
  assert.equal(viz.job, next);
  assert.equal(applyJobCompensation(surface(0.02)).name, 'outline.ngc (compensated)');
  setViz({ job: null });
});
