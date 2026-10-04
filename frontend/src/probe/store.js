// Probe session: authoritative vertex mesh + derived triangles + measured hits.
// Editing the mesh never moves the machine; probing fills z on vertices.
import { useSyncExternalStore } from 'react';
import { triangulate, applyMeasurements } from './mesh.js';

const initial = () => ({
  vertices: [],   // {id,x,y,z?,valid?} — z present once measured
  triangles: [],  // [i,j,k] into vertices, derived
  bounds: null,   // {minX,maxX,minY,maxY}
  results: [],
  progress: null, // { current, total }
  running: false,
  minZ: null,
  maxZ: null,
  lastTouch: null, // single-point touch, work coordinates
  session: null, // 'touch' | 'map' | null
});

export function createProbeStore() {
  let snapshot = initial();
  const listeners = new Set();

  const commit = (patch) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((l) => l());
  };

  // Rebuild triangles from the current vertex set (auto_level.md §4).
  const retriangulate = (vertices) => ({ vertices, triangles: triangulate(vertices) });

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** Replace the whole mesh (new board / regenerated lattice). */
    setMesh(vertices, bounds) {
      const next = retriangulate(vertices);
      commit({ ...next, bounds: bounds || snapshot.bounds });
    },

    /** Add vertices (refinement). Measured vertices are untouched. */
    addVertices(points) {
      if (!points?.length) return;
      const existing = new Set(snapshot.vertices.map((v) => `${Math.round(v.x * 100)}:${Math.round(v.y * 100)}`));
      const fresh = points.filter((p) => {
        const k = `${Math.round(p.x * 100)}:${Math.round(p.y * 100)}`;
        if (existing.has(k)) return false;
        existing.add(k);
        return true;
      });
      if (!fresh.length) return;
      commit(retriangulate([...snapshot.vertices, ...fresh]));
    },

    /** Remove a single vertex and re-triangulate. */
    removeVertex(id) {
      commit(retriangulate(snapshot.vertices.filter((v) => v.id !== id)));
    },

    clearResults() {
      commit({
        vertices: snapshot.vertices.map((v) => ({ ...v, z: undefined, valid: undefined })),
        results: [],
        progress: null,
        running: false,
        minZ: null,
        maxZ: null,
      });
    },

    begin(kind) {
      const patch = { running: true, session: kind };
      if (kind === 'map') {
        patch.results = [];
        patch.progress = { current: 0, total: 0 };
        patch.minZ = null;
        patch.maxZ = null;
      }
      commit(patch);
    },

    halt() {
      if (snapshot.running) commit({ running: false });
    },

    bind(connection) {
      connection.on('autolevel:update', (msg) => {
        const positions = Array.isArray(msg?.positions) ? msg.positions : [];
        if (snapshot.session === 'touch') {
          commit({
            lastTouch: msg?.probedPos || positions[0] || snapshot.lastTouch,
            running: (msg?.current ?? 0) < (msg?.total ?? 1),
          });
          return;
        }
        // attach each hit to its mesh vertex, then refresh triangles
        const vertices = snapshot.vertices.map((v) => ({ ...v }));
        applyMeasurements(vertices, positions);
        commit({
          vertices,
          triangles: triangulate(vertices),
          results: positions.length ? positions : snapshot.results,
          progress: { current: msg?.current ?? positions.length, total: msg?.total ?? positions.length },
          minZ: msg?.minZ ?? null,
          maxZ: msg?.maxZ ?? null,
          running: (msg?.current ?? 0) < (msg?.total ?? 0),
        });
      });
      connection.on('autolevel:complete', (msg) => {
        if (snapshot.session === 'touch') {
          const hit = msg?.positions?.[0];
          commit({ running: false, ...(hit ? { lastTouch: hit } : {}) });
          return;
        }
        const patch = { running: false };
        if (Array.isArray(msg?.positions)) {
          const vertices = snapshot.vertices.map((v) => ({ ...v }));
          applyMeasurements(vertices, msg.positions);
          patch.vertices = vertices;
          patch.triangles = triangulate(vertices);
          patch.results = msg.positions;
          patch.minZ = msg.minZ ?? snapshot.minZ;
          patch.maxZ = msg.maxZ ?? snapshot.maxZ;
        }
        commit(patch);
      });
      connection.on('workflow:state', (workflowState) => {
        if (workflowState === 'idle' && snapshot.running) {
          commit({ running: false });
        }
      });
    },
  };
}

export function useProbe(store) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
