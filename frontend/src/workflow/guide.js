// Step-guide store: what the operator should do at each workflow stage,
// shown as a modal when a stage becomes current (once per stage per page
// load unless re-opened). Content is plain data so it stays reviewable;
// "don't show again" is persisted per stage.
import { useSyncExternalStore } from 'react';

const PREFS_KEY = 'pcb-cnc.guide-prefs.v1';

export const GUIDE_STAGES = {
  connected: {
    title: 'Connect the machine',
    steps: [
      'Open Settings → Connection if the CNCjs server isn\u2019t reachable, then open the machine\u2019s serial port.',
      'Watch for the GRBL version banner in Console — that confirms the link is live.',
      'If GRBL reports Alarm on connect, that\u2019s normal after an e-stop: unlock ($X) once you\u2019ve checked the machine.'
    ],
    done: 'Port open and GRBL reports Idle.'
  },
  imported: {
    title: 'Import board sources',
    steps: [
      'Drag in the fab ZIP (recommended — layers are matched automatically), or pick Gerber + drill files individually.',
      'You need at least front copper; drill and outline are optional but recommended.',
      'The first imported file names this board session.'
    ],
    done: 'At least one source shows under CAM setup.'
  },
  generated: {
    title: 'Generate toolpaths',
    steps: [
      'Open CAM setup and walk its wizard: sources → tools → feeds & speeds → review.',
      'Check the tool diameters — effective V-bit width at depth is the #1 isolation quality factor.',
      'Generate. Each operation (isolation / drilling / outline) becomes a row in the run-operations stage.'
    ],
    done: 'CAM results list one operation per machining pass.'
  },
  toolpath: {
    title: 'Select the toolpath',
    steps: [
      'Preview each generated operation and load the one you\u2019ll machine first — usually isolation.',
      'Inspect the 3D path: full trace clearance, sensible depths, no stray moves onto the board.',
      'Later stages (surface probe bounds, run) reference the previewed job — switching operations re-anchors them.',
      'You\u2019ll come back here between operations to load the next one.'
    ],
    done: 'An operation is loaded into the visualizer (Previewing ✓).'
  },
  zeroedXY: {
    title: 'Mount board + zero XY',
    steps: [
      'Fix the blank copper-clad to the bed — double-sided tape or screws through waste areas.',
      'Decide the board origin: lower-left corner of the copper (or of the outline if imported).',
      'Jog the tool tip over that origin point, then press Zero XY (G10 L20 in G54).',
      'CAM\u2019s "Place board lower-left at work XY0" option must match where you zeroed.'
    ],
    done: 'DRO reads X0 Y0 at the board corner.'
  },
  zeroedZ: {
    title: 'Zero Z with the touch probe',
    steps: [
      'Connect the touch plate clip to the tool (or bit, depending on your probe wiring).',
      'Slide the plate under the tool tip; set its measured thickness in Probe settings.',
      'Confirm the wiring check when prompted — the live lamp must light when plate touches tool.',
      'Run Probe Z (G38.2). GRBL feeds down, touches, retracts; Z0 is set to the copper surface.',
      'Re-run Z after every tool change — Z is tool-length dependent, XY is not.'
    ],
    done: 'DRO reads Z0 (plate thickness applied) with the tool you\u2019ll cut with.'
  },
  verifyBounds: {
    title: 'Verify the work envelope',
    steps: [
      'Set a tour Z height that clears the board and any clamps or fixtures.',
      'Run the perimeter tour — the tool traces the job bounds plus margin at that height.',
      'Watch it the whole way: every edge must stay on copper and clear of clamps.',
      'If the tour leaves the board (edge-of-PCB jobs!), re-zero XY or re-mount the board, then tour again.',
      'This is exactly where the surface probe will travel — it confirms the lattice stays on copper.'
    ],
    done: 'The perimeter tour completed without leaving the copper or hitting anything.',
    skippable: true,
    skipNote: 'Skip only when you\u2019re certain the job area is well inside the copper — an off-board probe run drags the tool through empty space (or off the board entirely) at probe height.'
  },
  surface: {
    title: 'Probe the board surface (autolevel)',
    steps: [
      'The envelope tour should already have confirmed the bounds + margin stay on copper.',
      'Open Autolevel setup and generate a lattice covering the whole job area (with margin).',
      'Coverage is checked: paths outside the probed hull are rejected at compensation time.',
      'Confirm the wiring check before the pass — every lattice point is a tool-to-board touch.',
      'Run the probe pass — the machine taps each vertex and builds a height map.',
      'Optional but strongly recommended on any un-flattened board.'
    ],
    done: 'Height map shows measured Z at every vertex.',
    skippable: true,
    skipNote: 'Skip only if the board is known-flat — uncompensated cutting on an uneven board is the #1 isolation failure.'
  },
  compensated: {
    title: 'Apply surface compensation',
    steps: [
      'Press Apply compensation in Autolevel: cutting moves are Z-shifted onto the measured surface.',
      'The toolpath preview updates; the file name gains "(compensated)".',
      'Load the compensated G-code into the sender before starting — nominal and compensated files differ.'
    ],
    done: 'Visualizer shows the compensated job and the sender holds it.',
    skippable: true,
    skipNote: 'Skipping means cutting the nominal G-code — every Z is assumed perfectly flat.'
  },
  operations: {
    title: 'Run operations',
    steps: [
      'Load the first operation\u2019s G-code into the Job Runner and arm it.',
      'Pre-flight checks gates: tool mounted, Z fresh, sender matches preview, G54 / mm.',
      'Start. Watch the first plunge; feed-hold is your friend.',
      'Between operations with different tools: record the tool change, re-probe Z, then continue.'
    ],
    done: 'Every operation row reads done or skipped.'
  },
  park: {
    title: 'Park the machine',
    steps: [
      'Wait until the machine is idle — do not park while a job or probe is running.',
      'Pick an end program: rise 2 mm, rise then return to XY zero, or a custom program you saved.',
      'Stop spindle & park. M5 is sent first, then the move, so the tool is stopped before it travels.'
    ],
    done: 'Spindle is off and the tool is at the chosen park position.'
  },
  finish: {
    title: 'Inspect & finish',
    steps: [
      'The tool should already be parked. Vacuum the board before judging isolation quality.',
      'Inspect traces under magnification — look for un-cut slivers and depth variation.',
      'Drill and outline come last; tabs keep the board attached until you snap it free.',
      'Archive the session (or start the next board) when you\u2019re satisfied.'
    ],
    done: 'Board removed, machine parked, session archived.'
  }
};

let shownThisLoad = new Set(); // auto-opened stages for this page load
let suppressed = loadPrefs();
let current = null; // { stage, manual } | null
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());

function loadPrefs() {
  try { return new Set(JSON.parse(localStorage.getItem(PREFS_KEY) || '[]')); }
  catch { return new Set(); }
}

function persist() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify([...suppressed])); } catch { /* private mode */ }
}

export function getGuideState() { return current; }
export function subscribeGuide(l) { listeners.add(l); return () => listeners.delete(l); }
export function useGuide() { return useSyncExternalStore(subscribeGuide, getGuideState); }

/** Show the guide for a stage. Manual opens always work (even if suppressed). */
export function openGuide(stage, { manual = false } = {}) {
  if (!GUIDE_STAGES[stage]) return;
  current = { stage, manual: manual === true };
  emit();
}

export function closeGuide() { current = null; emit(); }

/** Auto-open on stage change unless the operator suppressed it (or it already
 *  showed this page load). Returns true when the modal actually opened. */
export function maybeAutoOpenGuide(stage) {
  if (!GUIDE_STAGES[stage]) return false;
  if (suppressed.has(stage) || shownThisLoad.has(stage)) return false;
  shownThisLoad.add(stage);
  openGuide(stage);
  return true;
}

export function suppressGuide(stage) {
  suppressed.add(stage);
  persist();
}

export function unsuppressGuide(stage) {
  suppressed.delete(stage);
  persist();
  emit();
}

export function isSuppressed(stage) { return suppressed.has(stage); }

export function resetGuidePrefs() {
  suppressed = new Set();
  persist();
  emit();
}

/** Test hook: forget what auto-opened this page load. */
export function __resetAutoOpened() { shownThisLoad = new Set(); }
