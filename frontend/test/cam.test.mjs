import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGcode } from '../src/jobs/parseGcode.js';
import { CamClient } from '../src/cam/client.js';
import { loadedJobMatches } from '../src/cnc/jobRunner.js';
import { loadCamOperation } from '../src/cam/preview.js';
import { viz, setViz } from '../src/visualizer/vizStore.js';

test('zero-padded pcb2gcode motion words preserve paths, plunge and retract', () => {
  const job = parseGcode('G21\nG90\nG00 Z3\nG00 X4 Y4\nG01 Z-0.08 F40\nG01 X16 Y4 F120\nG00 Z3\n');
  assert.equal(job.paths.length, 1);
  assert.equal(job.paths[0].segments.length, 2);
  assert.equal(job.paths[0].segments[1].end.x, 16);
  assert.equal(job.paths[0].segments[0].end.z, -0.08);
  assert.equal(job.rapidMoves.length, 3);
});

test('Loading CAM G-code uses the shared parser/viewer without invoking machine commands', () => {
  const drawn = [];
  setViz({ scene: { setJob: (job) => drawn.push(job), setRapids: (moves) => drawn.push(moves), setPreviewCursor: () => {} } });
  const op = { id: 'front', name: 'Front isolation', filename: 'front.ngc', tool: '0.2 mm bit',
    gcode: 'G21\nG90\nG00 Z3\nG00 X4 Y4\nG01 Z-0.08 F40\nG01 X16 F120\nG00 Z3\n' };
  const job = loadCamOperation(op);
  assert.equal(viz.job, job);
  assert.equal(job.paths[0].operationId, 'front');
  assert.equal(job.tool, op.tool);
  assert.equal(job.text, op.gcode);
  assert.equal(drawn.length, 2);
  assert.throws(() => loadCamOperation({ ...op, gcode: 'G21\nM2' }), /no cutting/);
  setViz({ scene: null, job: null, selection: null });
});

test('CAM client authenticates without opening a machine port', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => url.endsWith('/signin') ? { token: 'test-token' } : { available: true } };
  };
  try {
    const client = new CamClient({ serverUrl: '' });
    assert.equal((await client.status()).available, true);
    await client.generate({ front: { name: 'front', content: 'gerber' } }, {});
    assert.deepEqual(calls.map((c) => c.url), ['/api/signin', '/api/cam/status', '/api/cam/generate']);
    assert.equal(calls[2].options.headers.Authorization, 'Bearer test-token');
    assert.equal(calls[2].options.method, 'POST');
  } finally { globalThis.fetch = original; }
});

test('CAM errors retain the process diagnostics', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 422, json: async () => ({ msg: 'pcb2gcode failed', stderr: 'Invalid Gerber', stdout: 'Importing' }) });
  try {
    await assert.rejects(new CamClient({ token: 'existing-token' }).generate({}, {}), (err) =>
      err.message === 'pcb2gcode failed' && err.stderr === 'Invalid Gerber');
  } finally { globalThis.fetch = original; }
});

test('switching CAM operation or port invalidates a previously loaded sender job', () => {
  const job = { name: 'front.ngc', text: 'G1 X1' };
  const loaded = { ...job, port: '/dev/test' };
  assert.equal(loadedJobMatches(loaded, job, '/dev/test'), true);
  assert.equal(loadedJobMatches(loaded, { ...job, name: 'drill.ngc' }, '/dev/test'), false);
  assert.equal(loadedJobMatches(loaded, { ...job, text: 'G1 X2' }, '/dev/test'), false);
  assert.equal(loadedJobMatches(loaded, job, '/dev/other'), false);
  assert.equal(loadedJobMatches(loaded, job, null), false);
});
