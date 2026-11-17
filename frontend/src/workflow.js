// Pure next-step computation for the status footer's workflow guide.
// Mirrors the brief's core flow: connect → import → (compensate) → load → run.
// Advisory only; every action remains explicit in its widget.
import { STAGES, currentStage } from './workflow/session.js';

export function computeNextStep({
  serverConnected = false,
  port = null,
  machineBusy = false,
  jobRunning = false,
  paused = false,
  hasJob = false,
  compensationPending = false,
  senderReady = false,
  stateLabel = ''
} = {}) {
  if (!serverConnected) return { label: 'Connect CNCjs server', widget: 'connection' };
  if (!port) return { label: 'Open machine port', widget: 'connection' };
  if (jobRunning) {
    return paused
      ? { label: 'Job paused — resume in Job Runner', widget: 'runner' }
      : { label: 'Job running', widget: 'runner' };
  }
  if (machineBusy) return { label: `Machine busy (${stateLabel || 'moving'})`, widget: 'runner' };
  if (!hasJob) return { label: 'Import CAM or load G-code', widget: 'cam' };
  if (compensationPending) {
    return { label: 'Probe surface ready — apply compensation?', widget: 'autolevel' };
  }
  if (!senderReady) return { label: 'Load job into sender', widget: 'runner' };
  return { label: 'Pre-flight check, then Start', widget: 'runner' };
}

// --- Session-aware next step (authoritative when a guided session exists) ---
// Walks the 9 session stages in order and returns the first undone one, so
// loading G-code never skips mounting/zeroing/probing/compensation: those
// stages are only done when the operator (or reconciliation) marked them.
const STAGE_NEXT_LABELS = {
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

export function computeSessionNextStep({ session = null, workflowState = null, probeRunning = false } = {}) {
  if (!session) return { label: 'New board session', widget: 'guided-start', stage: null };
  // A surface-probe cycle also drives the feeder's workflow state — narrate it
  // as the probing stage, not as a sender job.
  if (probeRunning) return { label: 'Probing surface — in progress', widget: 'autolevel', stage: 'surface' };
  if (workflowState === 'running') return { label: 'Job running', widget: 'runner', stage: 'operations' };
  if (workflowState === 'paused') return { label: 'Job paused — resume in Job Runner', widget: 'runner', stage: 'operations' };
  const cur = currentStage(session);
  if (!cur) return { label: 'Board complete', widget: 'runner', stage: null };
  const stage = STAGES.find((s) => s.id === cur);
  return { label: STAGE_NEXT_LABELS[cur] ?? stage?.title ?? cur, widget: stage?.widget ?? 'runner', stage: cur };
}

/** Ask the Guided mode (if mounted) to open its wizard at a stage. */
export function openGuidedStage(stageId) {
  window.dispatchEvent(new CustomEvent('guided:open-stage', { detail: { stage: stageId } }));
}
