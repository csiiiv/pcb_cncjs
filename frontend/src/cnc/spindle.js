// Match CNCjs's GRBL spindle widget eligibility for ordinary G-code commands.
export function canControlSpindle(snap) {
  return snap.server === 'connected' && Boolean(snap.connectedPort)
    && snap.controllerType === 'Grbl'
    && ['Idle', 'Hold'].includes(snap.activeState)
    && snap.workflowState !== 'running';
}

export function reportedSpindleMode(snap) {
  if (!snap.connectedPort || snap.server !== 'connected') return null;
  // Accessory status reflects realtime spindle-stop overrides; modal M3/M4
  // alone can still say "on" while an override has stopped the output.
  if (snap.accessoryState != null) {
    if (snap.accessoryState.includes('S')) return 'M3';
    if (snap.accessoryState.includes('C')) return 'M4';
    return 'M5';
  }
  return snap.modal?.spindle ?? null;
}
