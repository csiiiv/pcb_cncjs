import { test } from 'node:test';
import assert from 'node:assert/strict';

// localStorage stub before importing modules that touch it at load.
const ls = new Map();
globalThis.localStorage = {
  getItem: (k) => (ls.has(k) ? ls.get(k) : null),
  setItem: (k, v) => ls.set(k, String(v)),
  removeItem: (k) => ls.delete(k)
};

// session must be imported before guide (guide reads nothing from session,
// but the reconciler test imports both).
const session = await import('../src/workflow/session.js');
const guide = await import('../src/workflow/guide.js');
const { computeSessionNextStep, computeNextStep } = await import('../src/workflow.js');
const zeroEvents = await import('../src/workflow/zeroEvents.js');

// --- session-aware footer step ----------------------------------------------

test('session walk: loading G-code does not skip setup stages', () => {
  session.startSession('board');
  // stages 1-4 done (imported + generated + toolpath → G-code exists in the world)
  for (const st of ['connected', 'imported', 'generated', 'toolpath']) session.setStageDone(st, true);
  // footer must NOT say "load job into sender" — mount/zero/probe first
  const next = computeSessionNextStep({ session: session.getSession() });
  assert.equal(next.stage, 'zeroedXY');
  assert.equal(next.label, 'Mount board + zero XY');
  assert.equal(next.widget, 'controls');
});

test('session walk: probes the full stage sequence in order', () => {
  session.startSession();
  const order = ['connected', 'imported', 'generated', 'toolpath', 'zeroedXY', 'zeroedZ', 'verifyBounds', 'surface', 'compensated'];
  const expected = {
    connected: 'Connect the machine',
    imported: 'Import Gerber / drill sources',
    generated: 'Generate toolpaths',
    toolpath: 'Select the toolpath to machine',
    zeroedXY: 'Mount board + zero XY',
    zeroedZ: 'Zero Z (touch probe)',
    verifyBounds: 'Verify the work envelope',
    surface: 'Probe the board surface',
    compensated: 'Apply compensation',
    operations: 'Run operations — load & start',
    park: 'Park — spindle off, then move clear',
    finish: 'Finish board — inspect & archive'
  };
  for (const st of Object.keys(expected)) {
    const next = computeSessionNextStep({ session: session.getSession() });
    assert.equal(next.stage, st, `walk order at ${st}`);
    assert.equal(next.label, expected[st]);
    session.setStageDone(st, true);
  }
  // all done → board complete
  assert.equal(computeSessionNextStep({ session: session.getSession() }).label, 'Board complete');
  session.abandonSession();
});

test('session walk: running/paused jobs take precedence', () => {
  session.startSession();
  session.setStageDone('connected', true);
  assert.equal(
    computeSessionNextStep({ session: session.getSession(), workflowState: 'running' }).label,
    'Job running'
  );
  assert.equal(
    computeSessionNextStep({ session: session.getSession(), workflowState: 'paused' }).label,
    'Job paused — resume in Job Runner'
  );
  session.abandonSession();
});

test('session walk: surface-probe cycles narrate as probing, not sender jobs', () => {
  session.startSession();
  for (const st of ['connected', 'imported', 'generated', 'toolpath', 'zeroedXY', 'zeroedZ']) session.setStageDone(st, true);
  const next = computeSessionNextStep({ session: session.getSession(), probeRunning: true });
  assert.equal(next.label, 'Probing surface — in progress');
  assert.equal(next.stage, 'surface');
  session.abandonSession();
});

test('no session → guided-start hint', () => {
  const next = computeSessionNextStep({ session: null });
  assert.equal(next.label, 'New board session');
  assert.equal(next.widget, 'guided-start');
});

// --- skipped stages -----------------------------------------------------------

test('skipStage records a visible skip decision for skippable stages only', () => {
  session.startSession();
  session.skipStage('zeroedXY', 'nope'); // not skippable → ignored
  assert.equal(session.getSession().stages.zeroedXY.done, false);
  session.setStageDone('zeroedXY', true);
  session.setStageDone('zeroedZ', true);
  session.skipStage('verifyBounds');
  assert.equal(session.getSession().stages.verifyBounds.done, true);
  assert.equal(session.getSession().stages.verifyBounds.skipped, true);
  session.skipStage('surface');
  const st = session.getSession().stages.surface;
  assert.equal(st.done, true);
  assert.equal(st.skipped, true);
  session.abandonSession();
});

// --- guide store ---------------------------------------------------------------

test('guide auto-opens once per stage per page load and respects suppression', () => {
  guide.__resetAutoOpened();
  assert.equal(guide.getGuideState(), null);
  assert.equal(guide.maybeAutoOpenGuide('zeroedXY'), true);
  assert.equal(guide.getGuideState()?.stage, 'zeroedXY');
  guide.closeGuide();
  // second auto-open for the same stage: already shown this load
  assert.equal(guide.maybeAutoOpenGuide('zeroedXY'), false);
  // manual opens always work
  guide.openGuide('zeroedZ', { manual: true });
  assert.equal(guide.getGuideState()?.stage, 'zeroedZ');
  guide.closeGuide();
  // suppression → never auto-opens again
  guide.suppressGuide('surface');
  assert.equal(guide.maybeAutoOpenGuide('surface'), false);
  guide.unsuppressGuide('surface');
  guide.__resetAutoOpened();
  assert.equal(guide.maybeAutoOpenGuide('surface'), true);
  guide.closeGuide();
});

test('guide content covers all stages', () => {
  for (const st of session.STAGES) {
    assert.ok(guide.GUIDE_STAGES[st.id], `missing guide content for ${st.id}`);
    assert.ok(Array.isArray(guide.GUIDE_STAGES[st.id].steps) && guide.GUIDE_STAGES[st.id].steps.length >= 3, `${st.id} steps`);
    assert.ok(typeof guide.GUIDE_STAGES[st.id].done === 'string', `${st.id} done-when`);
  }
  // skippable stages carry a skip note
  assert.ok(guide.GUIDE_STAGES.verifyBounds.skippable && guide.GUIDE_STAGES.verifyBounds.skipNote);
  assert.ok(guide.GUIDE_STAGES.surface.skippable && guide.GUIDE_STAGES.surface.skipNote);
  assert.ok(guide.GUIDE_STAGES.compensated.skippable && guide.GUIDE_STAGES.compensated.skipNote);
});

test('bounds tour program traces the margin box at clearance Z', async () => {
  const { boundsTourProgram } = await import('../src/guided/boundsTour.js');
  const program = boundsTourProgram({ minX: 0, maxX: 10, minY: 0, maxY: 8 }, 3);
  assert.equal(program[0], 'G21');
  assert.equal(program[1], 'G90');
  assert.ok(program[2].includes('verify envelope'));
  assert.ok(program.includes('G0 Z3.000'));
  // perimeter: all four corners, closing back at the start corner
  const moves = program.filter((l) => l.startsWith('G0 X'));
  assert.deepEqual(moves, [
    'G0 X0.000 Y0.000',
    'G0 X10.000 Y0.000',
    'G0 X10.000 Y8.000',
    'G0 X0.000 Y8.000',
    'G0 X0.000 Y0.000'
  ]);
});

// --- zero-event parsing ---------------------------------------------------------

test('parseZeroWrite recognizes every G10 L20 shape the app sends', () => {
  assert.deepEqual(
    zeroEvents.parseZeroWrite('G10 L20 P1 X0 Y0'),
    { axes: ['X', 'Y'], wcs: 'G54', plate: null }
  );
  assert.deepEqual(
    zeroEvents.parseZeroWrite('G10 L20 P1 X0 Y0 Z0'),
    { axes: ['X', 'Y', 'Z'], wcs: 'G54', plate: 0 }
  );
  assert.deepEqual(
    zeroEvents.parseZeroWrite('G10 L20 P1 Z5.000'), // touch probe plate offset
    { axes: ['Z'], wcs: 'G54', plate: 5 }
  );
  assert.equal(zeroEvents.parseZeroWrite('G0 X10'), null);
  assert.equal(zeroEvents.parseZeroWrite('G10 L20 P1'), null); // no axes
  assert.equal(zeroEvents.parseZeroWrite(42), null);
});

test('zeroWriteCovers helpers', () => {
  const xy = zeroEvents.parseZeroWrite('G10 L20 P1 X0 Y0');
  const z = zeroEvents.parseZeroWrite('G10 L20 P1 Z5.000');
  assert.equal(zeroEvents.zeroWriteCoversXY(xy), true);
  zeroWriteCoversXYChecks(z);
});

function zeroWriteCoversXYChecks(z) {
  assert.equal(zeroEvents.zeroWriteCoversXY(z), false); // Z-only write
  assert.equal(zeroEvents.zeroWriteCoversZ(z), true);
}

// --- reconciler (fake stores) ----------------------------------------------------

test('reconciler marks stages done from real events', async () => {
  const rec = await import('../src/workflow/reconcile.js');
  // smallest fake stores that satisfy the reconciler's deps
  const machListeners = new Set();
  const machStore = {
    subscribe: (fn) => { machListeners.add(fn); return () => machListeners.delete(fn); },
    getSnapshot: () => ({ connectedPort: null, workflowState: null, sender: null })
  };
  let camSnap = { files: {}, result: null };
  const probeListeners = new Set();
  const probe = {
    subscribe: (fn) => { probeListeners.add(fn); return () => probeListeners.delete(fn); },
    getSnapshot: () => ({ vertices: [], running: false })
  };
  const vizObj = { job: null, compensatedJob: null };
  const vizListeners = new Set();
  const vizSub = (fn) => { vizListeners.add(fn); return () => vizListeners.delete(fn); };
  const connHandlers = {};
  const conn = {
    on: (ev, fn) => { (connHandlers[ev] ||= []).push(fn); return () => {}; }
  };
  const sessionListeners = new Set();
  const sessionSub = (fn) => { sessionListeners.add(fn); return () => sessionListeners.delete(fn); };

  session.startSession('rec-board');
  const unbind = rec.bindReconciler({
    conn, machStore, getCamState: () => camSnap, probe, vizObj, vizSub, sessionSub
  });

  // 1. port opens → connected
  let machSnap = { connectedPort: '/dev/ttyUSB0', workflowState: null, sender: null };
  machStore.getSnapshot = () => machSnap;
  machListeners.forEach((fn) => fn());
  assert.equal(session.getSession().stages.connected.done, true);
  machSnap = { connectedPort: null, workflowState: null, sender: null };
  machListeners.forEach((fn) => fn());
  assert.equal(session.getSession().stages.connected.done, false, 'closing the port re-opens connect');
  machSnap = { connectedPort: '/dev/ttyUSB0', workflowState: null, sender: null };
  machListeners.forEach((fn) => fn());
  assert.equal(session.getSession().stages.connected.done, true);

  // 2. CAM import + result → imported + generated + operations seeded
  camSnap = { files: { front: { name: 'front.gtl' } }, result: {
    operations: [{ id: 'op-iso', name: 'Front isolation', type: 'isolation', tool: 'V0.2', depth: -0.08 }]
  } };
  await new Promise((r) => setTimeout(r, 550)); // cam poll interval
  const s2 = session.getSession();
  assert.equal(s2.stages.imported.done, true);
  assert.equal(s2.stages.generated.done, true);
  assert.equal(s2.stages.toolpath.done, false); // generated ≠ selected
  assert.equal(s2.board, 'rec-board'); // explicit name not overwritten
  assert.equal(s2.operations.length, 1);
  assert.equal(s2.operations[0].name, 'Front isolation');

  // 2b. previewing a CAM operation → select-toolpath
  vizObj.job = { text: 'iso', operationId: 'op-iso' };
  vizListeners.forEach((fn) => fn());
  const s2b = session.getSession();
  assert.equal(s2b.stages.toolpath.done, true);
  assert.equal(s2b.stages.toolpath.operationId, 'op-iso');

  // 3. G10 L20 X0 Y0 on the wire → zeroedXY
  connHandlers['serialport:write'].forEach((fn) => fn('G10 L20 P1 X0 Y0'));
  assert.equal(session.getSession().stages.zeroedXY.done, true);

  // 4. touch-probe Z write → zeroedZ with plate
  connHandlers['serialport:write'].forEach((fn) => fn('G10 L20 P1 Z5.000'));
  const s4 = session.getSession();
  assert.equal(s4.stages.zeroedZ.done, true);
  assert.equal(s4.stages.zeroedZ.plate, 5);

  // 4b. bounds tour verified, then the preview switches operation → re-open
  session.setStageDone('verifyBounds', true, { z: 3, operationId: 'op-iso' });
  vizObj.job = { text: 'iso', operationId: 'op-outline' };
  vizListeners.forEach((fn) => fn());
  assert.equal(session.getSession().stages.verifyBounds.done, false, 'switching the previewed operation re-opens verify-bounds');
  // verified for the operation now previewed stays done
  session.setStageDone('verifyBounds', true, { z: 3, operationId: 'op-outline' });
  vizListeners.forEach((fn) => fn());
  assert.equal(session.getSession().stages.verifyBounds.done, true, 'verified for the current operation stays done');
  // an explicit skip is never re-opened
  session.skipStage('verifyBounds', 'operator');
  vizObj.job = { text: 'x', operationId: 'op-third' };
  vizListeners.forEach((fn) => fn());
  assert.equal(session.getSession().stages.verifyBounds.done, true, 'skipped stays skipped');
  vizObj.job = { text: 'iso', operationId: 'op-iso' };
  vizListeners.forEach((fn) => fn());

  // 5. probe mesh fills → surface
  let probeSnap = { vertices: [{ x: 0, y: 0, z: 0.01 }, { x: 1, y: 0, z: -0.01 }, { x: 0, y: 1, z: 0 }], running: false, minZ: -0.01, maxZ: 0.01 };
  probe.getSnapshot = () => probeSnap;
  probeListeners.forEach((fn) => fn());
  const s5 = session.getSession();
  assert.equal(s5.stages.surface.done, true);
  assert.equal(s5.stages.surface.points, 3);

  // clearing the map re-opens the stage (an explicit skip would stay skipped)
  probeSnap = { vertices: [], running: false, minZ: null, maxZ: null };
  probe.getSnapshot = () => probeSnap;
  probeListeners.forEach((fn) => fn());
  assert.equal(session.getSession().stages.surface.done, false);

  // 6. compensation applied → compensated
  vizObj.compensatedJob = { text: 'comp' };
  vizObj.job = { text: 'comp', operationId: 'op-iso' };
  vizListeners.forEach((fn) => fn());
  assert.equal(session.getSession().stages.compensated.done, true);

  // 7. run cycle: busy → idle marks the operation done
  machSnap = { connectedPort: '/dev/ttyUSB0', workflowState: 'running', sender: { total: 10, received: 0 } };
  machListeners.forEach((fn) => fn());
  assert.equal(session.getSession().activeOperationId, 'op-iso');
  machSnap = { connectedPort: '/dev/ttyUSB0', workflowState: null, sender: { total: 10, received: 10 } };
  machListeners.forEach((fn) => fn());
  assert.equal(session.getSession().operations[0].status, 'done');

  // 8. revert compensation re-opens the decision (not skipped)
  vizObj.compensatedJob = null;
  vizListeners.forEach((fn) => fn());
  assert.equal(session.getSession().stages.compensated.done, false);

  unbind();
  session.abandonSession();
});

test('park presets: builtins, comment stripping, and saved custom programs', async () => {
  const park = await import('../src/guided/parkPresets.js');
  assert.equal(park.BUILTIN_PARK.length, 2);
  assert.deepEqual(park.parkLines('G21\n; comment\n\nG91 (relative)\nG0 Z2'), ['G21', 'G91', 'G0 Z2']);
  park.saveCustomPark([{ id: 'custom-1', name: 'Back left', gcode: 'G0 X0 Y80', custom: true }]);
  const loaded = park.loadCustomPark();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].name, 'Back left');
  assert.equal(loaded[0].custom, true);
  park.saveCustomPark([]);
});
