// Phase 3/4 visualizer panel: load, render, select, and control visibility.
import { useEffect, useRef, useState } from 'react';
import { parseGcode, pathLength } from '../jobs/parseGcode.js';
import ToolpathCanvas from './ToolpathCanvas.jsx';

export default function VisualizerPanel({
  sceneRef: externalSceneRef,
  onJobLoaded,
  selection: externalSelection,
  onSelect: externalOnSelect
}) {
  const localSceneRef = useRef(null);
  const sceneRef = externalSceneRef ?? localSceneRef;
  const fileRef = useRef(null);
  const [internalJob, setInternalJob] = useState(null);
  const [internalSelection, setInternalSelection] = useState(null);
  const [error, setError] = useState(null);
  const job = internalJob;
  const selection = externalSelection !== undefined ? externalSelection : internalSelection;
  const setSelection = externalOnSelect ?? setInternalSelection;

  const loadFile = async (file) => {
    try {
      setError(null);
      const text = await file.text();
      const parsed = parseGcode(text);
      const fullJob = { ...parsed, name: file.name, text };
      setInternalJob(fullJob);
      setSelection(null);
      onJobLoaded?.(fullJob);
      const scene = sceneRef.current;
      if (scene) {
        scene.setJob(parsed);
        scene.setRapids(parsed.rapidMoves);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) loadFile(file);
  };

  const onSelect = (sel) => {
    setSelection(sel);
    if (!sel) {
      sceneRef.current?.highlightPath(null);
    } else if (sel.region) {
      // region select: highlight nothing yet; UI offers actions on pathIds
    } else {
      sceneRef.current?.highlightPath(sel.pathId);
    }
  };

  const scene = sceneRef.current;
  const selectedPath =
    selection && !selection.region && job ? job.paths.find((p) => p.id === selection.pathId) : null;
  const regionPaths =
    selection?.region && job
      ? selection.pathIds.map((id) => job.paths.find((p) => p.id === id)).filter(Boolean)
      : [];

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onSelect(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <section className="panel viz-panel" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
      <div className="dro-head">
        <h2>Toolpath</h2>
        {job ? (
          <span className="hint">
            {job.name} — {job.stats.paths} paths · {job.stats.cutSegments} segments ·{' '}
            {job.stats.rapids} rapids
            {scene?.hiddenCount ? ` · ${scene.hiddenCount} hidden` : ''}
          </span>
        ) : (
          <span className="hint">drop a .nc/.gcode file or</span>
        )}
        <span className="hint">shift+drag = region · ctrl+drag or right-drag = pan · wheel = zoom</span>
        <span className="spacer" />
        {job && (
          <span className="view-buttons">
            {['top', 'left', 'right', 'iso'].map((v) => (
              <button key={v} onClick={() => sceneRef.current?.setView(v)} title={`view: ${v}`}>
                {v === 'iso' ? 'ISO' : v[0].toUpperCase() + v.slice(1)}
              </button>
            ))}
          </span>
        )}
        {job && (
          <>
            <button onClick={() => sceneRef.current?.showAll()}>Show All</button>
            <button onClick={() => onSelect(null)}>Clear selection</button>
          </>
        )}
        <button onClick={() => fileRef.current?.click()}>Load G-code</button>
        <input
          ref={fileRef}
          type="file"
          accept=".nc,.gcode,.ngc,.txt"
          style={{ display: 'none' }}
          onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])}
        />
      </div>

      {error && <div className="error">{error}</div>}

      <ToolpathCanvas sceneRef={sceneRef} onSelect={onSelect} />

      {selectedPath && (
        <div className="selection-info">
          <div className="sel-title">
            <b>Path {selectedPath.id}</b>
            <span className="sel-actions">
              <button onClick={() => sceneRef.current?.isolatePath(selectedPath.id)}>Isolate</button>
              <button onClick={() => sceneRef.current?.hidePath(selectedPath.id)}>Hide</button>
              <button onClick={() => sceneRef.current?.hideOthers(selectedPath.id)}>Hide Others</button>
            </span>
          </div>
          <div>
            {selectedPath.segments.length} segments · depth {selectedPath.depth?.toFixed(3)} mm ·
            feed {selectedPath.feed} mm/min · length {pathLength(selectedPath).toFixed(1)} mm
            {selection && !selection.region && (
              <span className="hint">
                {' '}· segment {selection.segmentId} (source line {selection.sourceLine})
              </span>
            )}
          </div>
        </div>
      )}

      {regionPaths.length > 0 && (
        <div className="selection-info">
          <div className="sel-title">
            <b>Region — {regionPaths.length} paths</b>
            <span className="sel-actions">
              <button onClick={() => regionPaths.forEach((p) => sceneRef.current?.hidePath(p.id))}>
                Hide Selected
              </button>
              <button
                onClick={() => {
                  const keep = new Set(regionPaths.map((p) => p.id));
                  job.paths.forEach((p) => {
                    if (!keep.has(p.id)) sceneRef.current?.hidePath(p.id);
                  });
                }}
              >
                Isolate
              </button>
            </span>
          </div>
          <div className="hint">
            paths {regionPaths.map((p) => p.id).join(', ')} ·{' '}
            {regionPaths.reduce((n, p) => n + p.segments.length, 0)} segments total
          </div>
        </div>
      )}
    </section>
  );
}
