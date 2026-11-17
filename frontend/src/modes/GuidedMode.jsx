// Guided PCB Milling mode: subway rail (left) + toolpath/gcode (center) +
// compact machine column (right), orchestrated by the workflow session
// (docs/ui-modes.md §4, docs/workflow.md). Stage actions live in the
// dedicated GuidedWizard modal (guided/GuidedWizard.jsx) — purpose-built
// step views over the same stores/commands, for a consistent guided UX.
// Stage completion is reconciled from real machine/cam/probe activity by
// workflow/reconcile.js (bound at App level), so it stays honest in every
// UI mode.
import { useEffect, useMemo, useRef, useState } from 'react';
import SubwayRail from '../widgets/SubwayRail.jsx';
import MachinePanel from '../widgets/compact/MachinePanel.jsx';
import ConsoleWidget from '../widgets/ConsoleWidget.jsx';
import VisualizerWidget from '../widgets/VisualizerWidget.jsx';
import GcodePreviewWidget from '../widgets/GcodePreviewWidget.jsx';
import GuidedWizard from '../guided/GuidedWizard.jsx';
import { toast } from '../ui/toast.js';
import { machineCommands } from '../cnc/runtime.js';
import {
  useSession, startSession, abandonSession, STAGES, currentStage,
  setStageDone, setToolMounted, zFreshSinceToolChange
} from '../workflow/session.js';
import { useMachineState } from '../cnc/runtime.js';
import { useCam } from '../cam/store.js';
import { takeModeRouting } from './modeRegistry.js';
import { focusWidget } from '../widgets/focus.js';

const GUIDED_PREFS_KEY = 'pcb-cnc.guided-prefs.v1';
function loadPrefs() {
  try { return { gcodeCollapsed: false, ...JSON.parse(localStorage.getItem(GUIDED_PREFS_KEY) || '{}') }; }
  catch { return { gcodeCollapsed: false }; }
}

/** Live gates: session claims reconciled against machine/cam reality. */
function useGates() {
  const session = useSession();
  const snap = useMachineState();
  const cam = useCam();

  return useMemo(() => {
    const gates = new Map();
    if (!session) return gates;
    const st = session.stages;
    const put = (id, blocked, reason) => gates.set(id, { blocked: Boolean(blocked), reason: blocked ? reason : null });

    put('connected', !snap.connectedPort, 'Machine port not connected');
    put('imported', Object.keys(cam.files || {}).length === 0, 'No CAM sources imported');
    put('generated', !cam.result, 'Generate toolpaths first');
    put('toolpath', !cam.result, 'Generate toolpaths first');
    put('zeroedXY', !snap.connectedPort, 'Connect first');
    put('zeroedZ', !snap.connectedPort, 'Connect first');
    put('verifyBounds', !st.zeroedZ.done, 'Zero Z first');
    put('surface', !(st.verifyBounds.done || st.verifyBounds.skipped), 'Verify the envelope (or skip) first');
    put('compensated', !(st.surface.done || st.surface.skipped), 'Probe surface (or skip) first');

    const ops = session.operations || [];
    const opBlocked = ops.length === 0
      ? 'No operations recorded (generate first)'
      : !zFreshSinceToolChange(session) ? 'Re-probe Z after tool change'
      : null;
    put('operations', Boolean(opBlocked), opBlocked);
    const opsDone = ops.length > 0 && ops.every((o) => ['done', 'skipped'].includes(o.status));
    put('park', !opsDone, 'Operations not complete');
    const finishBlocked = !opsDone ? 'Operations not complete' : !st.park?.done ? 'Park the machine first' : null;
    put('finish', Boolean(finishBlocked), finishBlocked);
    return gates;
  }, [session, snap.connectedPort, cam.result, cam.files]);
}

export default function GuidedMode() {
  const session = useSession();
  const snap = useMachineState();
  const [prefs, setPrefs] = useState(loadPrefs);
  const [wizardStage, setWizardStage] = useState(null);
  const rightRef = useRef(null);
  const gates = useGates();

  useEffect(() => {
    try { localStorage.setItem(GUIDED_PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
  }, [prefs]);

  // Cross-mode focus handoff (ui-modes.md §6)
  useEffect(() => {
    const pending = takeModeRouting();
    if (pending.focusWidget) {
      requestAnimationFrame(() => focusWidget(pending.focusWidget));
    }
  }, []);

  // Footer "next →" with an active session opens the wizard at that stage
  useEffect(() => {
    const onOpenStage = (e) => setWizardStage(e.detail?.stage ?? null);
    window.addEventListener('guided:open-stage', onOpenStage);
    return () => window.removeEventListener('guided:open-stage', onOpenStage);
  }, []);

  // Stage completion, operation seeding, run reconciliation: app-wide in
  // workflow/reconcile.js. This mode renders + opens the wizard.

  if (!session) {
    return (
      <div className="guided-empty">
        <h2>No active board</h2>
        import a board, zero, probe, compensate, run — the subway keeps the order.
        <div className="seg">
          <button className="primary" onClick={() => { startSession(); setWizardStage('connected'); }}>New board</button>
        </div>
      </div>
    );
  }

  const current = currentStage(session);
  const cur = STAGES.find((s) => s.id === current);
  const alarmed = snap.activeState === 'Alarm' || snap.activeState === 'Door';

  const selectStage = (id) => {
    setWizardStage(id); // every stage now opens the wizard — dedicated step view
  };

  return (
    <div className="guided-mode">
      {/* LEFT: session header + subway + actions */}
      <aside className="guided-left">
        <div className="guided-session-head">
          <div className="gsh-title">{session.board}</div>
          <div className="hint">
            {STAGES.filter((s) => session.stages[s.id]?.done).length}/{STAGES.length} stages
            {session.toolMounted ? ` · tool: ${session.toolMounted.description}` : ''}
          </div>
        </div>
        <SubwayRail gates={gates} selectedStage={wizardStage} onSelectStage={selectStage} />
        <div className="guided-actions">
          {cur && (
            <button className="guided-next primary" onClick={() => setWizardStage(current)}>
              next: {cur.title.toLowerCase()} →
            </button>
          )}
          <div className="seg">
            <button onClick={() => {
              const desc = prompt('Tool description (e.g. 0.2 mm V-bit):', session.toolMounted?.description || '');
              if (desc !== null) setToolMounted(desc.trim() || null);
            }}>Tool…</button>
            <button onClick={() => { if (confirm('Abandon this board session?')) abandonSession(); }}>Abandon</button>
          </div>
        </div>
      </aside>

      {/* CENTER: toolpath + collapsible gcode (wizard docks over as a modal) */}
      <main className="guided-center">
        <div className="gc-viz"><VisualizerWidget /></div>
        <div className={`gc-gcode ${prefs.gcodeCollapsed ? 'collapsed' : ''}`}>
          <button
            className="gc-gcode-toggle"
            aria-expanded={!prefs.gcodeCollapsed}
            onClick={() => setPrefs((p) => ({ ...p, gcodeCollapsed: !p.gcodeCollapsed }))}
          >
            G-code {prefs.gcodeCollapsed ? '▸' : '▾'}
          </button>
          {!prefs.gcodeCollapsed && (
            <div className="gc-gcode-body">
              <GcodePreviewWidget />
            </div>
          )}
        </div>
      </main>

      {/* RIGHT: compact machine column + console */}
      <aside className="guided-right" ref={rightRef}>
        <MachinePanel />
        <div className="guided-console"><ConsoleWidget /></div>
      </aside>

      {/* dedicated step wizard — one consistent UI for every stage action */}
      <GuidedWizard
        open={wizardStage !== null}
        stageId={wizardStage}
        onClose={() => setWizardStage(null)}
        onNavigate={setWizardStage}
      />

      {alarmed && (
        <div className="alarm-interstitial" role="alertdialog" aria-label="Machine alarm">
          <div className="ai-panel">
            <h3>⚠ Machine alarm</h3>
            Motion halted. Resolve the fault, then re-confirm before continuing.
            <div className="seg">
              <button onClick={() => machineCommands.unlock()}>Unlock ($X)</button>
              <button onClick={() => {
                setToolMounted(null);
                setStageDone('zeroedZ', false);
                toast('Re-probe Z before continuing');
              }}>Re-check zero</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
