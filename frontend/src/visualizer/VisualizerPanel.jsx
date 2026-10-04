// Phase 3 visualizer panel: load a .nc file, parse, render, inspect.
// Selecting a segment shows its full metadata chain (path → segment → source line).
import { useEffect, useRef, useState } from 'react';
import { parseGcode, pathLength } from '../jobs/parseGcode.js';
import ToolpathCanvas from './ToolpathCanvas.jsx';

export default function VisualizerPanel({ sceneRef: externalSceneRef }) {
  const localSceneRef = useRef(null);
  const sceneRef = externalSceneRef ?? localSceneRef;
  const fileRef = useRef(null);
  const [job, setJob] = useState(null);
  const [selection, setSelection] = useState(null);
  const [error, setError] = useState(null);

  const loadFile = async (file) => {
    try {
      setError(null);
      const text = await file.text();
      const parsed = parseGcode(text);
      setJob({ ...parsed, name: file.name, text });
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
    sceneRef.current?.highlightPath(sel ? sel.pathId : null);
  };

  const selectedPath = selection && job ? job.paths.find((p) => p.id === selection.pathId) : null;

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
          </span>
        ) : (
          <span className="hint">drop a .nc/.gcode file or</span>
        )}
        <button disabled={!job} onClick={() => onSelect(null)}>Clear selection</button>
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
          <b>Path {selectedPath.id}</b>
          {' — '}{selectedPath.segments.length} segments · depth {selectedPath.depth?.toFixed(3)} mm ·
          feed {selectedPath.feed} mm/min · length {pathLength(selectedPath).toFixed(1)} mm
          {selection && (
            <span className="hint">
              {' '}· segment {selection.segmentId} (source line {selection.sourceLine})
            </span>
          )}
        </div>
      )}
    </section>
  );
}
