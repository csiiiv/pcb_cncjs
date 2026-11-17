// Heightmap comparison modal: load two saved heightmap files and diff them
// point-by-point (reproducibility check). Deltas render as a colored dot
// overlay in the 3D view via a scene method.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useViz } from '../visualizer/vizStore.js';
import { fmtAxis } from '../cnc/runtime.js';
import { parseHeightmap, compareHeightmaps } from '../probe/heightmapFile.js';
import { colormapCSS } from '../probe/colormap.js';
import { ResizeEdge, useModalStack, useModalWidth, isTopModal } from '../ui/ModalKit.jsx';

export default function HeightmapCompareModal({ open, onClose }) {
  const v = useViz();
  const [maps, setMaps] = useState([null, null]); // [A, B] parsed heightmaps
  const [error, setError] = useState(null);
  const fileRefs = [useRef(null), useRef(null)];
  const [modalWidth, setModalWidth] = useModalWidth('heightmap-compare', 420);
  useModalStack(open, 'heightmap-compare');

  useEffect(() => {
    if (!open) {
      setMaps([null, null]);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && isTopModal('heightmap-compare')) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // cleanup overlay when closing
  useEffect(() => () => v.scene?.setHeightmapDiff?.(null), [v.scene]); // eslint-disable-line

  const both = maps[0] && maps[1];
  const result = both ? compareHeightmaps(maps[0], maps[1]) : null;

  // draw the diff overlay when both maps are loaded (hook must run before
  // the early return below — hook count must stay constant)
  useEffect(() => {
    if (!open) return;
    if (!result) {
      v.scene?.setHeightmapDiff?.(null);
      return;
    }
    v.scene?.setHeightmapDiff?.(result);
  }, [open, result, v.scene]); // eslint-disable-line

  if (!open) return null;

  const load = async (slot, file) => {
    try {
      const text = await file.text();
      const hm = parseHeightmap(JSON.parse(text));
      setMaps((m) => m.map((x, i) => (i === slot ? hm : x)));
      setError(null);
    } catch (err) {
      setError(`slot ${slot === 0 ? 'A' : 'B'}: ${err.message}`);
    }
  };

  const stat = (label, value, digits = 3) => (
    <div className="hm-stat">
      <span className="hm-stat-label">{label}</span>
      <span className="hm-stat-value">{value}</span>
    </div>
  );

  return createPortal(
    <div className="modal-backdrop side" onMouseDown={onClose}>
      <div
        className="modal-panel"
        role="dialog"
        aria-label="Compare heightmaps"
        style={{ width: modalWidth }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <ResizeEdge width={modalWidth} setWidth={setModalWidth} />
        <div className="modal-head">
          <h2>Heightmap comparison</h2>
          <span className="hint">reproducibility check — ΔZ between two saved maps</span>
          <span className="spacer" />
          <button onClick={onClose} title="close">×</button>
        </div>
        <div className="modal-body">
          {error && <div className="error">{error}</div>}
          <div className="modal-cols">
            {[0, 1].map((slot) => (
              <section key={slot}>
                <h3>Map {slot === 0 ? 'A (reference)' : 'B (compare)'}</h3>
                {maps[slot] ? (
                  <div className="probe-row">
                    <span className="hint">
                      <b>{maps[slot].name}</b><br />
                      {maps[slot].points.length} points
                      {maps[slot].createdAt && <> · {new Date(maps[slot].createdAt).toLocaleString()}</>}
                    </span>
                    <span className="spacer" />
                    <button onClick={() => setMaps((m) => m.map((x, i) => (i === slot ? null : x)))}>Clear</button>
                  </div>
                ) : (
                  <div className="probe-row">
                    <button onClick={() => fileRefs[slot].current?.click()}>Load .heightmap.json…</button>
                    <input
                      ref={fileRefs[slot]}
                      type="file"
                      accept=".json"
                      style={{ display: 'none' }}
                      onChange={(e) => e.target.files?.[0] && load(slot, e.target.files[0])}
                    />
                  </div>
                )}
              </section>
            ))}
          </div>

          {result && (
            <>
              <h3>ΔZ statistics (A − B)</h3>
              <div className="hm-stats">
                {stat('matched', `${result.matched} / ${maps[0].points.length}`)}
                {stat('mean', `${result.mean >= 0 ? '+' : ''}${result.mean.toFixed(3)} mm`)}
                {stat('RMS', `${result.rms.toFixed(3)} mm`)}
                {stat('std dev', `${result.std.toFixed(3)} mm`)}
                {stat('min', `${result.min.toFixed(3)} mm`)}
                {stat('max', `${result.max.toFixed(3)} mm`)}
                {stat('p95', `${result.p95.toFixed(3)} mm`)}
                {stat('unmatched A/B', `${result.unmatchedA} / ${result.unmatchedB}`)}
              </div>
              <div className="probe-row legend-row">
                <span className="hint">ΔZ color</span>
                <span className="legend-swatch" style={{
                  background: `linear-gradient(to right, ${colormapCSS('blue-red', 0)}, ${colormapCSS('blue-red', 0.5)}, ${colormapCSS('blue-red', 1)})`
                }} />
                <span className="hint">
                  {fmtAxis(-Math.max(Math.abs(result.min), Math.abs(result.max), 1e-6))} … {fmtAxis(Math.max(Math.abs(result.min), Math.abs(result.max), 1e-6))} mm
                </span>
              </div>
              <p className="hint">
                Dots at each matched point in the 3D view show ΔZ on the shared blue→red scale
                (mid = 0). Interpretation: mean ≈ 0 and RMS within your probe repeatability
                (~0.01–0.02 mm) means the maps reproduce; a tilted plane (smooth gradient across
                the board) usually indicates the workpiece shifted or re-clamped between runs.
              </p>
            </>
          )}
        </div>
        <div className="modal-foot">
          <span className="hint">{both ? 'ΔZ overlay active in the toolpath view' : 'load two heightmaps to compare'}</span>
          <span className="spacer" />
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
