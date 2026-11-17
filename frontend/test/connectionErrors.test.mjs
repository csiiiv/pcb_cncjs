import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectionErrorMessage } from '../src/cnc/errors.js';
import { CNCConnection } from '../src/cnc/connection.js';
import { createMachineStateStore } from '../src/cnc/state.js';

test('serial error events unwrap CNCjs payloads without displaying object coercion', () => {
  const handlers = {};
  const store = createMachineStateStore();
  store.bind({ on: (name, handler) => { handlers[name] = handler; } });
  handlers['serialport:error']({ port: '/dev/test', err: { message: 'Cannot lock port' } });
  assert.equal(store.getSnapshot().serialError, 'Cannot lock port');
  assert.equal(connectionErrorMessage(new Error('EIO')), 'EIO');
  assert.equal(connectionErrorMessage({ err: 'Port is busy' }), 'Port is busy');
  assert.equal(connectionErrorMessage({ err: {} }, 'Unable to open port'), 'Unable to open port');
});

test('port open and close report serialized errors and reject disconnected sockets', async () => {
  const connection = new CNCConnection();
  connection.socket = { connected: true, emit: (event, ...args) => args.at(-1)({ message: 'Cannot lock port' }) };
  await assert.rejects(connection.openPort('/dev/test'), /Cannot lock port/);
  await assert.rejects(connection.closePort('/dev/test'), /Cannot lock port/);
  connection.socket.connected = false;
  await assert.rejects(connection.openPort('/dev/test'), /Server is not connected/);
  await assert.rejects(connection.closePort('/dev/test'), /Server is not connected/);
});
