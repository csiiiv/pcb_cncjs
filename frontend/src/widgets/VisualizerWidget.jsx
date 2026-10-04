// Visualizer: 3D toolpath canvas + view/visibility toolbar (job via viz store).
import { useEffect, useRef } from 'react';
import { parseGcode, pathLength } from '../jobs/parseGcode.js';
import ToolpathCanvas from '../visualizer/ToolpathCanvas.jsx';
import { viz, setViz, useViz } from '../visualizer/vizStore.js';
import { useStoreSelector, probeStore, useProbe } from '../cnc/runtime.js';

// Subscribes only to position, so console/ack frames don't touch the 3D scene.
function MachinePositionTracker({ sceneRef }) {
  const connectedPort = useStoreSelector((s) => s.connectedPort);
  const wpos = useStoreSelector((s) => s.wpos);
  useEffect(() => {
    sceneRef.current?.setToolPosition(
      connectedPort && wpos
        ? { x: Number(wpos.x), y: Number(wpos.y), z: Number(wpos.z) }
        : null
    );
  }, [connectedPort, wpos, sceneRef]);
  return null;
}

function ProbeOverlay({ sceneRef }) {
  const probe = useProbe(probeStore);
  useEffect(() => {
    sceneRef.current?.setProbe(probe.vertices, probe.triangles);
  }, [probe.vertices, probe.triangles, sceneRef]);
  return null;
}

export default function VisualizerWidget() {
  const sceneRef = useRef(null);
  const v = useViz();

  const loadFile = async (file) => {
    const text = await file.text();
    const parsed = parseGcode(text);
    const job = { ...parsed, name: file.name, text };
    setViz({ job, selection: null });
    sceneRef.current?.setJob(parsed);
    sceneRef.current?.setRapids(parsed.rapidMoves);
  };

  const onDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) loadFile(f);
  };

  const onSelect = (sel) => {
    setViz({ selection: sel });
    if (!sel) sceneRef.current?.highlightPath(null);
    else if (!sel.region) sceneRef.current?.highlightPath(sel.pathId);
  };

  const job = v.job;
  const selectedPath =
    v.selection && !v.selection.region && job ? job.paths.find((p) => p.id === v.selection.pathId) : null;
  const regionPaths =
    v.selection?.region && job
      ? v.selection.pathIds.map((id) => job.paths.find((p) => p.id === id)).filter(Boolean)
      : [];

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onSelect(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <section className="widget viz-widget" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
      <div className="widget-head">
        <h2>Toolpath</h2>
        {job ? (
          <span className="hint">
            {job.name} — {job.stats.paths} paths · {job.stats.cutSegments} segments · {job.stats.rapids} rapids
            {v.scene?.hiddenCount ? ` · ${v.scene.hiddenCount} hidden` : ''}
          </span>
        ) : (
          <span className="hint">drop a .nc/.gcode file or</span>
        )}
        <span className="hint">shift+drag = region · ctrl/right-drag = pan · wheel = zoom</span>
        <span className="spacer" />
        {job && (
          <span className="view-buttons">
            {['top', 'left', 'right', 'iso'].map((vw) => (
              <button key={vw} onClick={() => sceneRef.current?.setView(vw)}>
                {vw === 'iso' ? 'ISO' : vw[0].toUpperCase() + vw.slice(1)}
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
        <FileButton onFile={loadFile} />
      </div>

      <ToolpathCanvas
        sceneRef={sceneRef}
        onSelect={onSelect}
        onReady={(scene) => setViz({ scene })}
      />

      {/* live machine position → tool marker (restored after dock refactor) */}
      <MachinePositionTracker sceneRef={sceneRef} />
      <ProbeOverlay sceneRef={sceneRef} />

      {(selectedPath || regionPaths.length > 0) && (
        <div className="selection-info">
          {selectedPath ? (
            <>
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
                {v.selection && !v.selection.region && (
                  <span className="hint">
                    {' '}· segment {v.selection.segmentId} (source line {v.selection.sourceLine})
                  </span>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="sel-title">
                <b>Region — {regionPaths.length} paths</b>
                <span className="sel-actions">
                  <button onClick={() => regionPaths.forEach((p) => sceneRef.current?.hidePath(p.id))}>
                    Hide Selected
                  </button>
                  <button onClick={() => {
                    const keep = new Set(regionPaths.map((p) => p.id));
                    job.paths.forEach((p) => !keep.has(p.id) && sceneRef.current?.hidePath(p.id));
                  }}>
                    Isolate
                  </button>
                </span>
              </div>
              <div className="hint">
                paths {regionPaths.map((p) => p.id).join(', ')} ·{' '}
                {regionPaths.reduce((n, p) => n + p.segments.length, 0)} segments total
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function FileButton({ onFile }) {
  const ref = useRef(null);
  return (
    <>
      <button onClick={() => ref.current?.click()}>Load G-code</button>
      <input
        ref={ref}
        type="file"
        accept=".nc,.gcode,.ngc,.txt"
        style={{ display: 'none' }}
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />
    </>
  );
}
