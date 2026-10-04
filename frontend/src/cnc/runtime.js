// Shared CNC runtime singletons — imported by every widget.
import { useSyncExternalStore } from 'react';
import { CNCConnection } from './connection.js';
import { createMachineStateStore, fmtAxis, stateColor } from './state.js';
import { MachineCommands } from './commands.js';

export const connection = new CNCConnection({ serverUrl: '' }); // same-origin via Vite proxy
export const store = createMachineStateStore();
store.bind(connection);
export const machineCommands = new MachineCommands(connection);

export function useMachineState() {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

export { fmtAxis, stateColor };
