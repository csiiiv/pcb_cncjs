// Guided-machining session: one board's diary through the 12 stages
// (docs/workflow.md). Pure data + transitions, persisted to localStorage;
// live machine state is read from the existing stores and *reconciled*
// against this record, never stored inside it.
import { useSyncExternalStore } from 'react';

export const SESSION_KEY = 'pcb-cnc.workflow.v1';

export const STAGES = [
  { id: 'connected',  title: 'Connect',        icon: '⏻', widget: 'connection' },
  { id: 'imported',   title: 'Import sources', icon: '⇪', widget: 'cam' },
  { id: 'generated',  title: 'Generate',       icon: '✧', widget: 'cam' },
  { id: 'toolpath',   title: 'Select toolpath', icon: '◫', widget: 'cam' },
  { id: 'zeroedXY',   title: 'Mount + Zero XY', icon: '⌖', widget: 'controls' },
  { id: 'zeroedZ',    title: 'Zero Z',         icon: '⊙', widget: 'probe' },
  { id: 'verifyBounds', title: 'Verify bounds', icon: '⌗', widget: 'controls' },
  { id: 'surface',    title: 'Probe surface',  icon: '△', widget: 'autolevel' },
  { id: 'compensated', title: 'Compensate',    icon: '≈', widget: 'autolevel' },
  { id: 'operations', title: 'Run operations', icon: '▶', widget: 'runner' },
  { id: 'park',       title: 'Park',           icon: '⌂', widget: 'controls' },
  { id: 'finish',     title: 'Finish',         icon: '✓', widget: 'runner' }
];

const OP_STATUS_ORDER = { pending: 0, ready: 1, running: 2, done: 3, failed: 3, skipped: 3 };

let session = null; // null = no active session
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
export const getSession = () => session;
export function useSession() { return useSyncExternalStore(subscribe, getSession); }
/** Imperative subscription for non-React reconcilers (same listeners as useSession). */
export const subscribeSession = subscribe;

function persist() {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* storage unavailable */ }
}

function load() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return sanitize(parsed);
  } catch { return null; }
}

/** Structural validation on load — a corrupted record must not crash the UI. */
function sanitize(s) {
  const stages = {};
  for (const st of STAGES) {
    const rec = s.stages?.[st.id];
    if (rec && typeof rec === 'object') {
      stages[st.id] = {
        done: rec.done === true,
        at: typeof rec.at === 'string' ? rec.at : null
      };
    } else {
      stages[st.id] = { done: false, at: null };
    }
  }
  const stagesIn = s.stages || {};
  if (Number.isFinite(stagesIn.zeroedZ?.plate)) stages.zeroedZ.plate = stagesIn.zeroedZ.plate;
  if (typeof stagesIn.toolpath?.operationId === 'string') stages.toolpath.operationId = stagesIn.toolpath.operationId.slice(0, 80);
  if (typeof stagesIn.park?.preset === 'string') stages.park.preset = stagesIn.park.preset.slice(0, 40);
  if (stagesIn.verifyBounds && typeof stagesIn.verifyBounds.skipped === 'boolean') {
    stages.verifyBounds.skipped = stagesIn.verifyBounds.skipped;
  }
  if (Number.isFinite(stagesIn.verifyBounds?.z)) stages.verifyBounds.z = stagesIn.verifyBounds.z;
  if (typeof stagesIn.verifyBounds?.operationId === 'string') stages.verifyBounds.operationId = stagesIn.verifyBounds.operationId.slice(0, 80);
  if (Number.isFinite(stagesIn.surface?.points)) stages.surface.points = stagesIn.surface.points;
  if (stagesIn.surface && typeof stagesIn.surface.skipped === 'boolean') stages.surface.skipped = stagesIn.surface.skipped;
  if (Number.isFinite(stagesIn.surface?.zMin) && Number.isFinite(stagesIn.surface?.zMax)) {
    stages.surface.zMin = stagesIn.surface.zMin;
    stages.surface.zMax = stagesIn.surface.zMax;
  }
  if (stagesIn.compensated && typeof stagesIn.compensated.skipped === 'boolean') {
    stages.compensated.skipped = stagesIn.compensated.skipped;
  }
  const operations = Array.isArray(s.operations)
    ? s.operations.filter((o) => o && typeof o.id === 'string' && typeof o.name === 'string')
      .map((o) => ({
        id: o.id,
        name: String(o.name).slice(0, 120),
        kind: ['isolation', 'drilling', 'outline'].includes(o.kind) ? o.kind : 'isolation',
        tool: typeof o.tool === 'object' && o.tool ? String(o.tool.description || '').slice(0, 120) : '',
        depth: Number.isFinite(o.depth) ? o.depth : null,
        compensated: o.compensated === true,
        status: OP_STATUS_ORDER.hasOwnProperty(o.status) ? o.status : 'pending',
        ranAt: typeof o.ranAt === 'string' ? o.ranAt : null,
        endState: ['ok', 'stopped', 'alarm'].includes(o.endState) ? o.endState : null
      }))
    : [];
  return {
    id: typeof s.id === 'string' ? s.id : `session-${Date.now()}`,
    startedAt: typeof s.startedAt === 'string' ? s.startedAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    board: typeof s.board === 'string' ? String(s.board).slice(0, 120) : 'Untitled board',
    stages,
    operations,
    activeOperationId: typeof s.activeOperationId === 'string' ? s.activeOperationId : null,
    toolMounted: s.toolMounted && typeof s.toolMounted === 'object'
      ? { description: String(s.toolMounted.description || '').slice(0, 120), since: typeof s.toolMounted.since === 'string' ? s.toolMounted.since : new Date().toISOString() }
      : null
  };
}

session = load();

function commit(next) {
  session = next;
  persist();
  emit();
}

export function startSession(board) {
  const stages = Object.fromEntries(STAGES.map((s) => [s.id, { done: false, at: null }]));
  commit({
    id: `session-${Date.now().toString(36)}`,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    board: board ? String(board).slice(0, 120) : 'Untitled board',
    stages, operations: [], activeOperationId: null, toolMounted: null
  });
  return session;
}

export function abandonSession() { commit(null); }

/** Mark a stage done/not-done with optional detail patch. */
export function setStageDone(stageId, done, patch = {}) {
  if (!session) return;
  const { board, ...stagePatch } = patch;
  const stages = { ...session.stages };
  stages[stageId] = {
    ...stages[stageId],
    ...stagePatch,
    done: done === true,
    at: done === true ? new Date().toISOString() : null
  };
  const next = { ...session, stages, updatedAt: new Date().toISOString() };
  // First import names an untitled session after the source file.
  if (done === true && board && next.board === 'Untitled board') next.board = String(board).slice(0, 120);
  commit(next);
}

/**
 * Skip a skippable stage (verify bounds / surface probe / compensation) with a
 * recorded, visible decision (workflow.md §2: skipping must be explicit, not omission).
 */
export function skipStage(stageId, reason = '') {
  if (!session) return;
  if (!['verifyBounds', 'surface', 'compensated'].includes(stageId)) return;  const stages = { ...session.stages };
  stages[stageId] = { ...stages[stageId], skipped: true, done: true, at: new Date().toISOString() };
  commit({ ...session, stages, updatedAt: new Date().toISOString() });
  return reason;
}

/** Record tool mount; resets Z-zero relevance (workflow.md §2 note). */
export function setToolMounted(description) {
  if (!session) return;
  commit({
    ...session,
    toolMounted: description
      ? { description: String(description).slice(0, 120), since: new Date().toISOString() }
      : null,
    updatedAt: new Date().toISOString()
  });
}

/** Seed operations from CAM results (id/name/kind/tool/depth per op). */
export function setOperations(ops) {
  if (!session) return;
  const prev = new Map(session.operations.map((o) => [o.id, o]));
  const operations = (ops || []).filter((o) => o && o.id && o.name).map((o) => {
    const old = prev.get(o.id);
    return {
      id: String(o.id).slice(0, 80),
      name: String(o.name).slice(0, 120),
      kind: ['isolation', 'drilling', 'outline'].includes(o.kind) ? o.kind : 'isolation',
      tool: String(o.tool || '').slice(0, 120),
      depth: Number.isFinite(o.depth) ? o.depth : null,
      compensated: old?.compensated ?? false,
      status: old?.status ?? 'pending',
      ranAt: old?.ranAt ?? null,
      endState: old?.endState ?? null
    };
  });
  commit({ ...session, operations, activeOperationId: null, updatedAt: new Date().toISOString() });
}

const forwardOk = (from, to) => OP_STATUS_ORDER[to] >= OP_STATUS_ORDER[from] && !(OP_STATUS_ORDER[from] === 3 && OP_STATUS_ORDER[to] < 3);

/** Operation status transitions only move forward (workflow.md §3). */
export function setOperationStatus(id, status, patch = {}) {
  if (!session || !OP_STATUS_ORDER.hasOwnProperty(status)) return;
  const operations = session.operations.map((o) => {
    if (o.id !== id) return o;
    if (!forwardOk(o.status, status)) return o;
    return {
      ...o,
      ...patch,
      status,
      ranAt: status === 'running' ? new Date().toISOString() : o.ranAt,
      endState: status === 'done' || status === 'failed' || status === 'skipped' ? (patch.endState || 'ok') : o.endState
    };
  });
  const activeOperationId = status === 'running' ? id
    : session.activeOperationId === id ? null : session.activeOperationId;
  commit({ ...session, operations, activeOperationId, updatedAt: new Date().toISOString() });
}

/** First not-done stage id (subway "current station"). */
export function currentStage(sessionRecord = session) {
  return STAGES.find((s) => !(sessionRecord?.stages?.[s.id]?.done))?.id ?? null;
}

/** True when every operation is done or skipped (stage 10 gate). */
export function operationsComplete(sessionRecord = session) {
  const ops = sessionRecord?.operations || [];
  return ops.length > 0 && ops.every((o) => ['done', 'skipped'].includes(o.status));
}

/** Z re-zeroed since the last tool change? (gate 3, workflow.md §4) */
export function zFreshSinceToolChange(sessionRecord = session) {
  const zAt = sessionRecord?.stages?.zeroedZ?.at;
  const toolAt = sessionRecord?.toolMounted?.since;
  if (!zAt) return false;
  return !toolAt || zAt > toolAt;
}

export function isActive() { return session !== null; }
export const __test = { sanitize, OP_STATUS_ORDER, forwardOk };
