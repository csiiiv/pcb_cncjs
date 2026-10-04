// Shared CNC runtime singletons — imported by every widget.
import { useSyncExternalStore } from 'react';
import { CNCConnection } from './connection.js';
import { createMachineStateStore, fmtAxis, stateColor } from './state.js';
import { MachineCommands } from './commands.js';
import { JobRunner } from './jobRunner.js';
import { ProbeCommands } from './probe.js';
import { createProbeStore, useProbe } from '../probe/store.js';

export const connection = new CNCConnection({ serverUrl: '' }); // same-origin via Vite proxy
export const store = createMachineStateStore();
store.bind(connection);
export const machineCommands = new MachineCommands(connection);
export const jobRunner = new JobRunner(connection);
export const probeStore = createProbeStore();
probeStore.bind(connection);
export const probeCommands = new ProbeCommands(connection);

export function useMachineState() {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

// Subscribe to a SLICE of the store: the component only re-renders when the
// selected value changes (Object.is on the selector result). Hot widgets
// (console rows, gcode rows) use this to stay isolated from DRO-position
// commits (4–10 Hz) and vice versa.
export function useStoreSelector(selector) {
  return useSyncExternalStore(store.subscribe, () => selector(store.getSnapshot()));
}

export { fmtAxis, stateColor, useProbe };
