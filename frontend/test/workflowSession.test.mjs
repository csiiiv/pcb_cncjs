import { test } from 'node:test';
import assert from 'node:assert/strict';

// session.js touches localStorage at module load; provide a stub before import.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k)
};

const session = await import('../src/workflow/session.js');

test('session starts empty and startSession seeds 12 undone stages', () => {
  assert.equal(session.isActive(), false);
  const s = session.startSession('MyBoard');
  assert.equal(session.isActive(), true);
  assert.equal(s.board, 'MyBoard');
  assert.equal(session.STAGES.length, 12);
  assert.equal(session.currentStage(), 'connected'); // first not-done
  assert.deepEqual(session.__test.sanitize({ nope: true }).operations, []);
});

test('verifyBounds sits between zeroedZ and surface and skips explicitly', () => {
  session.startSession();
  for (const id of ['connected', 'imported', 'generated', 'toolpath', 'zeroedXY', 'zeroedZ']) {
    session.setStageDone(id, true);
  }
  assert.equal(session.currentStage(), 'verifyBounds');
  assert.equal(session.skipStage('verifyBounds', 'why'), 'why');
  assert.equal(session.currentStage(), 'surface');
  const rec = session.getSession().stages.verifyBounds;
  assert.equal(rec.skipped, true);
  assert.equal(rec.done, true);
  // non-skippable stages refuse
  session.startSession();
  assert.equal(session.skipStage('connected'), undefined);
  assert.equal(session.getSession().stages.connected.skipped, undefined);
});

test('stage done transitions persist and currentStage advances', () => {
  session.setStageDone('connected', true);
  assert.equal(session.currentStage(), 'imported');
  assert.ok(session.getSession().stages.connected.at);
  session.setStageDone('connected', false); // undo
  assert.equal(session.currentStage(), 'connected');
  assert.equal(session.getSession().stages.connected.at, null);
});

test('first import names an untitled session after the source file', () => {
  session.startSession();
  session.setStageDone('imported', true, { board: 'proto.gtl' });
  assert.equal(session.getSession().board, 'proto.gtl');
  // explicit board names are not overwritten
  session.startSession('named');
  session.setStageDone('imported', true, { board: 'other.gtl' });
  assert.equal(session.getSession().board, 'named');
});

test('operations seed from CAM results and transition forward-only', () => {
  session.startSession();
  session.setOperations([
    { id: 'front', name: 'Front isolation', kind: 'isolation', tool: '0.2mm V', depth: -0.08 },
    { id: 'drill-1', name: 'Drilling · 0.8', kind: 'drilling', tool: '0.8 drill', depth: -1.6 }
  ]);
  let s = session.getSession();
  assert.equal(s.operations.length, 2);
  assert.equal(s.operations[0].status, 'pending');

  session.setOperationStatus('front', 'ready');
  session.setOperationStatus('front', 'running');
  session.setOperationStatus('front', 'done', { endState: 'ok' });
  s = session.getSession();
  assert.equal(s.operations[0].status, 'done');
  assert.equal(s.operations[0].endState, 'ok');
  assert.equal(session.getSession().activeOperationId, null); // cleared on done

  // backward transition rejected: done → running
  session.setOperationStatus('front', 'running');
  assert.equal(session.getSession().operations[0].status, 'done');

  // re-seeding preserves run history for same ids
  session.setOperations([
    { id: 'front', name: 'Front isolation', kind: 'isolation', tool: '0.2mm V', depth: -0.08 },
    { id: 'drill-1', name: 'Drilling · 0.8', kind: 'drilling', tool: '0.8 drill', depth: -1.6 }
  ]);
  assert.equal(session.getSession().operations[0].status, 'done');
});

test('completion + Z-freshness gates', () => {
  session.startSession();
  // no operations → not complete
  assert.equal(session.operationsComplete(), false);
  session.setOperations([{ id: 'front', name: 'Front', kind: 'isolation', tool: 't', depth: -0.1 }]);
  session.setOperationStatus('front', 'skipped');
  assert.equal(session.operationsComplete(), true);

  // Z zero before tool change = fresh; after = stale
  session.setStageDone('zeroedZ', true);
  assert.equal(session.zFreshSinceToolChange(), true);
  session.setToolMounted('0.8 end mill');
  assert.equal(session.zFreshSinceToolChange(), false);
});

test('sanitize rejects corrupted records and clamps fields', () => {
  const bad = session.__test.sanitize({ id: 7, stages: 'nope', operations: [{ id: 'x' }, null, { id: 'ok', name: 'Y', status: 'bogus', depth: 'NaN' }] });
  assert.equal(bad.operations.length, 1); // {id:'x'} (no name) and null dropped
  assert.equal(bad.operations[0].id, 'ok');
  assert.equal(bad.operations[0].status, 'pending'); // bogus → pending
  assert.equal(bad.operations[0].depth, null);
  assert.equal(bad.board, 'Untitled board');
  assert.deepEqual(bad.stages.surface, { done: false, at: null });
});

test('abandon clears the session and storage', () => {
  session.startSession('gone');
  session.abandonSession();
  assert.equal(session.isActive(), false);
  assert.equal(store.has('pcb-cnc.workflow.v1'), false);
});

test('mode registry loads persisted mode with URL override and guided default', async () => {
  const reg = await import('../src/modes/modeRegistry.js');
  assert.deepEqual(reg.MODE_IDS, ['debug', 'guided', 'test']);
  assert.equal(reg.loadMode(), 'guided'); // nothing stored → guided
  reg.saveMode('test');
  assert.equal(reg.loadMode(), 'test');
  // URL param wins once
  globalThis.location = { search: '?mode=debug' };
  assert.equal(reg.loadMode(), 'debug');
  delete globalThis.location;
  // routing round-trip
  reg.routeMode('guided', 'autolevel');
  assert.deepEqual(reg.takeModeRouting(), { mode: 'guided', focusWidget: 'autolevel' });
  assert.deepEqual(reg.takeModeRouting(), { mode: null, focusWidget: null }); // consumed
  reg.saveMode('guided');
});
