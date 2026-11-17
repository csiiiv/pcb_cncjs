// Machine-state reconciliation: derive session-stage completion from real
// machine/cam/probe/viz activity (workflow.md §6). The session record is a
// diary; these stores are reality. Bound once at App level, it works in
// every UI mode, keeping `currentStage()` honest so the footer's next-step
// walk neither skips stages nor stalls on stages that already happened.
//
// Everything here is passive: no machine commands are ever emitted.
import { connection, store as machineStore, probeStore } from '../cnc/runtime.js';
import { getCam } from '../cam/store.js';
import { viz, subscribeViz } from '../visualizer/vizStore.js';
import {
  getSession, subscribeSession, currentStage, setStageDone,
  setOperations, setOperationStatus
} from './session.js';
import { parseZeroWrite, zeroWriteCoversXY, zeroWriteCoversZ } from './zeroEvents.js';
import { maybeAutoOpenGuide } from './guide.js';

let unbind = null;

/** Measured vertices in the probe mesh (surface evidence). */
function measuredCount(snapshot) {
  return (snapshot?.vertices || []).filter((p) => Number.isFinite(Number(p.z))).length;
}

/**
 * Bind all reconciliation listeners. Idempotent (StrictMode-safe).
 * Injectable `deps` for tests. Returns an unbind (test-only; app never unbinds).
 */
export function bindReconciler({
  conn = connection,
  machStore = machineStore,
  getCamState = getCam,
  probe = probeStore,
  vizObj = viz,
  vizSub = subscribeViz,
  sessionSub = subscribeSession,
  stageDone = setStageDone,
  setOps = setOperations,
  setOpStatus = setOperationStatus,
  getSessionNow = getSession
} = {}) {
  if (unbind) return unbind;
  const offs = [];
  let lastSeededOps = '';

  // --- stages 1–3: connected / imported / generated --------------------------
  // CAM store exposes no subscribe; poll it cheaply. 500ms is far below any
  // human CAM interaction, and the check is idempotent.
  const checkCam = () => {
    const s = getSessionNow();
    if (!s) return;
    const cam = getCamState();
    if (Object.keys(cam.files || {}).length > 0 && !s.stages.imported.done) {
      stageDone('imported', true, {
        board: Object.values(cam.files).map((f) => f?.name).filter(Boolean)[0] || undefined
      });
    }
    if (cam.result && !getSessionNow().stages.generated.done) stageDone('generated', true);
    // Seed operations from CAM results (idempotent per generation)
    if (cam.result) {
      const key = cam.result.operations.map((o) => o.id).join(',');
      if (key && key !== lastSeededOps) {
        lastSeededOps = key;
        setOps(cam.result.operations.map((o) => ({
          id: o.id, name: o.name, kind: o.type === 'drill' ? 'drilling' : o.type === 'outline' ? 'outline' : 'isolation',
          tool: o.tool, depth: o.depth
        })));
      }
    }
  };
  const camTimer = setInterval(checkCam, 500);
  offs.push(() => clearInterval(camTimer));

  // Port open marks stage 1; workflow-state edges drive stage 10 (single
  // subscription: both read the same commit stream).
  let prevBusy = false;
  offs.push(machStore.subscribe(() => {
    const s = getSessionNow();
    if (!s) return;
    const snap = machStore.getSnapshot();
    if (snap.connectedPort && !s.stages.connected.done) stageDone('connected', true);
    // Port closed (or failed to stay open) — the connect step must be
    // available again. Done stays only while a port is actually open.
    if (!snap.connectedPort && s.stages.connected.done) stageDone('connected', false);
    const busy = ['running', 'paused'].includes(snap.workflowState);
    // Autolevel probe cycles also drive workflowState — they are probing
    // (surface stage), not sender jobs. Never touch operation status then.
    const probeBusy = probe.getSnapshot().running;
    if (busy && !prevBusy && !probeBusy) {
      // A run started: the sender holds the viz job's G-code; the viz job's
      // operationId says which CAM operation it is.
      const opId = vizObj.job?.operationId;
      if (opId && s.operations.some((o) => o.id === opId && o.status !== 'done' && o.status !== 'skipped')) {
        setOpStatus(opId, 'running', { compensated: vizObj.compensatedJob != null && vizObj.job?.text === vizObj.compensatedJob.text });
      }
    }
    if (!busy && prevBusy && !probeBusy && s.activeOperationId) {
      const sender = snap.sender;
      const endedOk = Boolean(sender && sender.total > 0 && sender.received >= sender.total);
      setOpStatus(s.activeOperationId, endedOk ? 'done' : 'failed', { endState: endedOk ? 'ok' : 'stopped' });
    }
    prevBusy = busy;
  }));

  // --- stages 4–5: zeroedXY / zeroedZ — serial write evidence ----------------
  // Every G10 L20 the controller receives is echoed as serialport:write —
  // watching the wire covers all UI paths (buttons, console, macros). A
  // touch-probe Z zero arrives as 'G10 L20 P1 Z<plate>'.
  offs.push(conn.on('serialport:write', (data) => {
    const s = getSessionNow();
    if (!s) return;
    const info = parseZeroWrite(String(data));
    if (!info) return;
    if (zeroWriteCoversXY(info) && !s.stages.zeroedXY.done) stageDone('zeroedXY', true);
    if (zeroWriteCoversZ(info) && !s.stages.zeroedZ.done) {
      stageDone('zeroedZ', true, Number.isFinite(info.plate) && info.plate !== 0 ? { plate: info.plate } : {});
    }
  }));

  // --- stage 6: surface — probe mesh filled ----------------------------------
  offs.push(probe.subscribe(() => {
    const s = getSessionNow();
    if (!s) return;
    const snap = probe.getSnapshot();
    const count = measuredCount(snap);
    // ≥3 measured vertices = a map (a single touch probe is the zeroedZ stage).
    // Clearing the mesh below that re-opens the stage so a reset is real —
    // an explicit skip stays skipped.
    if (!snap.running && count >= 3 && !s.stages.surface.done) {
      const patch = { points: count };
      if (Number.isFinite(snap.minZ) && Number.isFinite(snap.maxZ)) { patch.zMin = snap.minZ; patch.zMax = snap.maxZ; }
      stageDone('surface', true, patch);
    }
    if (!snap.running && count < 3 && s.stages.surface.done && !s.stages.surface.skipped) {
      stageDone('surface', false);
    }
  }));

  // --- stage 9: compensated — viz store holds a live compensated job ---------
  offs.push(vizSub(() => {
    const s = getSessionNow();
    if (!s) return;
    const applied = vizObj.compensatedJob != null && vizObj.job?.text === vizObj.compensatedJob.text;
    const st = s.stages.compensated;
    if (applied && !st.done) stageDone('compensated', true);
    // revert re-opens the decision (an explicit skip stays skipped)
    if (!applied && st.done && !st.skipped) stageDone('compensated', false);
  }));

  // --- stage 4: toolpath — a CAM operation is previewed in the viz ----------
  // Selecting a toolpath (loadCamOperation) sets job.operationId; loading a
  // bare .nc file leaves it undefined — that's the run-operations stage. Marking
  // done on selection keeps zero/probe/run stages anchored to a concrete job.
  const toolpathSelected = () => {
    const s = getSessionNow();
    if (!s) return;
    const opId = vizObj.job?.operationId;
    if (opId && !s.stages.toolpath.done) stageDone('toolpath', true, { operationId: opId });
  };
  offs.push(vizSub(toolpathSelected));
  toolpathSelected(); // reload mid-board with a preview already up

  // --- stage 7: verifyBounds — invalidation only ------------------------------
  // Completion is marked by the step when its tour program finishes (the
  // reconciler can't distinguish tour motion from any other G0s). But the
  // verified envelope is anchored to the previewed job recorded in the stage
  // patch: switching operations changes the bounds, so the old tour no longer
  // proves anything. Re-open on mismatch (an explicit skip stays skipped).
  const verifyStillValid = () => {
    const s = getSessionNow();
    if (!s) return;
    const st = s.stages.verifyBounds;
    const opId = vizObj.job?.operationId;
    if (st.done && !st.skipped && st.operationId && opId && opId !== st.operationId) {
      stageDone('verifyBounds', false);
    }
  };
  offs.push(vizSub(verifyStillValid));
  verifyStillValid();

  // --- stage 10: operation completion — a run that went busy→idle -----------
  // (folded into the machine-store subscription above)

  // --- guide auto-open: narrate each stage as it becomes current -------------
  let lastNarrated = null;
  const narrate = () => {
    const s = getSessionNow();
    if (!s) { lastNarrated = null; return; }
    const cur = currentStage(s);
    if (cur && cur !== lastNarrated) {
      lastNarrated = cur;
      maybeAutoOpenGuide(cur);
    }
  };
  offs.push(sessionSub(narrate));
  narrate(); // session restored from a previous page load → narrate current

  // Run all checks once against current reality (reload mid-board).
  checkCam();
  const machNow = machStore.getSnapshot();
  if (getSessionNow() && machNow.connectedPort) stageDone('connected', true);
  if (getSessionNow() && !machNow.connectedPort && getSessionNow().stages.connected.done) stageDone('connected', false);
  const snapProbe = probe.getSnapshot();
  const sNow = getSessionNow();
  if (sNow && !snapProbe.running && measuredCount(snapProbe) >= 3 && !sNow.stages.surface.done) {
    stageDone('surface', true, { points: measuredCount(snapProbe) });
  }
  if (sNow && vizObj.compensatedJob != null && vizObj.job?.text === vizObj.compensatedJob.text && !sNow.stages.compensated.done) {
    stageDone('compensated', true);
  }

  unbind = () => offs.forEach((off) => off());
  return unbind;
}
