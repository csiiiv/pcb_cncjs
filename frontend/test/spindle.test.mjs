import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MachineCommands } from '../src/cnc/commands.js';
import { canControlSpindle, reportedSpindleMode } from '../src/cnc/spindle.js';
import { createMachineStateStore } from '../src/cnc/state.js';

const ready = {
  server: 'connected', connectedPort: '/dev/test', controllerType: 'Grbl',
  activeState: 'Idle', workflowState: 'idle'
};

test('spindle commands route through CNCjs without implicit motion', () => {
  const sent = [];
  const commands = new MachineCommands({ connectedPort: '/dev/test', socket: {
    emit: (...args) => sent.push(args)
  } });
  commands.spindleStart('M3', 12000);
  commands.spindleStart('M4', 8000);
  commands.spindleSpeed(10000);
  commands.spindleStart('M3', 0);
  commands.spindleStop();
  assert.deepEqual(sent, ['M3 S12000', 'M4 S8000', 'S10000', 'M3 S0', 'M5']
    .map((line) => ['command', '/dev/test', 'gcode', [line]]));
  for (const rpm of [-1, NaN, Infinity, 1.5, '', '1000', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => commands.spindleStart('M3', rpm));
    assert.throws(() => commands.spindleSpeed(rpm));
  }
  assert.throws(() => commands.spindleStart('M5', 1000));
  assert.equal(sent.length, 5);
  assert.throws(() => new MachineCommands({ connectedPort: null }).spindleStop());
});

test('manual spindle commands require the CNCjs GRBL eligible states', () => {
  assert.equal(canControlSpindle(ready), true);
  assert.equal(canControlSpindle({ ...ready, activeState: 'Hold', workflowState: 'paused' }), true);
  for (const patch of [
    { server: 'disconnected' }, { connectedPort: null }, { controllerType: 'Marlin' },
    { workflowState: 'running' }, ...['Run', 'Alarm', 'Door', 'Jog', 'Home', 'Check', 'Sleep', null]
      .map((activeState) => ({ activeState }))
  ]) assert.equal(canControlSpindle({ ...ready, ...patch }), false);
});

test('realtime accessory state takes precedence over programmed spindle mode', () => {
  const snap = { ...ready, modal: { spindle: 'M3' } };
  assert.equal(reportedSpindleMode(snap), 'M3');
  assert.equal(reportedSpindleMode({ ...snap, accessoryState: 'SF' }), 'M3');
  assert.equal(reportedSpindleMode({ ...snap, accessoryState: 'C' }), 'M4');
  assert.equal(reportedSpindleMode({ ...snap, accessoryState: '' }), 'M5');
  assert.equal(reportedSpindleMode({ ...snap, accessoryState: 'F' }), 'M5');
  assert.equal(reportedSpindleMode({ ...snap, connectedPort: null }), null);
});

test('store separates programmed and realtime RPM and clears stale data on reconnect', () => {
  const handlers = {};
  const store = createMachineStateStore();
  store.bind({ on: (name, handler) => { handlers[name] = handler; } });
  handlers.state('connected');
  const open = () => handlers['serialport:open']({ port: '/dev/test', controllerType: 'Grbl' });
  const report = () => handlers['controller:state']('Grbl', {
    status: { activeState: 'Idle', spindle: 6000, accessoryState: 'S' },
    parserstate: { spindle: '12000', modal: { spindle: 'M3' } }
  });
  open();
  report();
  assert.equal(store.getSnapshot().spindle, '12000');
  assert.equal(store.getSnapshot().spindleRpm, 6000);
  assert.equal(reportedSpindleMode(store.getSnapshot()), 'M3');
  handlers.state('disconnected');
  assert.equal(store.getSnapshot().spindleRpm, null);
  assert.equal(reportedSpindleMode(store.getSnapshot()), null);
  handlers.state('connected');
  open();
  assert.equal(canControlSpindle(store.getSnapshot()), false);
  report();
  handlers['serialport:close']({ port: '/dev/test' });
  assert.equal(store.getSnapshot().spindle, null);
  assert.equal(store.getSnapshot().spindleRpm, null);
});
