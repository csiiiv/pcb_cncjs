import { test } from 'node:test';
import assert from 'node:assert/strict';

// localStorage stub before importing modules that touch it at load.
const ls = new Map();
globalThis.localStorage = {
  getItem: (k) => (ls.has(k) ? ls.get(k) : null),
  setItem: (k, v) => ls.set(k, String(v)),
  removeItem: (k) => ls.delete(k)
};

const wiring = await import('../src/probe/wiring.js');
const settings = await import('../src/settings/store.js');

test('probe start is gated by default and fires the run on confirm', () => {
  let ran = 0;
  wiring.requestProbeStart({ kind: 'touch', detail: 'Z · G38.2', run: () => { ran += 1; } });
  assert.equal(ran, 0); // gated — modal opens instead of moving
  assert.equal(wiring.getWiringCheck()?.kind, 'touch');
  assert.equal(wiring.getWiringCheck()?.detail, 'Z · G38.2');
  wiring.confirmWiringStart();
  assert.equal(ran, 1);
  assert.equal(wiring.getWiringCheck(), null);
});

test('cancel keeps the machine still', () => {
  let ran = 0;
  wiring.requestProbeStart({ kind: 'map', run: () => { ran += 1; } });
  wiring.cancelWiringStart();
  assert.equal(ran, 0);
  assert.equal(wiring.getWiringCheck(), null);
});

test('a second request replaces the pending one (never queues motion)', () => {
  let first = 0;
  let second = 0;
  wiring.requestProbeStart({ kind: 'touch', run: () => { first += 1; } });
  wiring.requestProbeStart({ kind: 'map', run: () => { second += 1; } });
  assert.equal(wiring.getWiringCheck().kind, 'map'); // latest wins
  wiring.confirmWiringStart();
  assert.equal(first, 0);
  assert.equal(second, 1);
});

test('disabling the confirmation in settings fires immediately', () => {
  // default factory state: confirmWiring true
  assert.equal(settings.getDefaults('probe').confirmWiring, true);
  wiring.setWiringConfirmEnabled(false);
  assert.equal(settings.getDefaults('probe').confirmWiring, false);
  let ran = 0;
  wiring.requestProbeStart({ kind: 'test', run: () => { ran += 1; } });
  assert.equal(ran, 1); // no gate — runs straight away
  assert.equal(wiring.getWiringCheck(), null);
  // re-enable: gated again
  wiring.setWiringConfirmEnabled(true);
  wiring.requestProbeStart({ kind: 'test', run: () => {} });
  assert.ok(wiring.getWiringCheck());
  wiring.cancelWiringStart();
});

test('confirmWiring survives a settings save round-trip (schema accepts it)', () => {
  wiring.setWiringConfirmEnabled(false);
  // reload from storage the way a fresh page load would
  const reloaded = settings.loadDefaults(globalThis.localStorage);
  assert.equal(reloaded.probe.confirmWiring, false);
  wiring.setWiringConfirmEnabled(true);
  const reloaded2 = settings.loadDefaults(globalThis.localStorage);
  assert.equal(reloaded2.probe.confirmWiring, true);
});

test('a stored confirmWiring:false from before this feature still disables the gate', () => {
  // legacy settings record without the key: factory default (true) applies
  ls.delete(settings.SETTINGS_KEY);
  const defaults = settings.loadDefaults(globalThis.localStorage);
  assert.equal(defaults.probe.confirmWiring, true);
});
