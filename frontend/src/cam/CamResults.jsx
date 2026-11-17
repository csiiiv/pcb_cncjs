import { useViz } from '../visualizer/vizStore.js';
import { downloadCamFile } from './preview.js';

export default function CamResults({ result, stale, busy, onLoad }) {
  const v = useViz();
  if (!result) return null;
  return <>
    {stale && <p className="hint">Sources/settings changed. These toolpaths belong to the previous generation.</p>}
    <div className="cam-operations">
      {result.operations.map((op) => <div className="cam-operation" key={op.id}>
        <b>{op.name}</b>
        <div className="hint">Tool: {op.tool} · Z {op.depth} mm · F {op.feed} mm/min · {op.rpm} RPM</div>
        {v.job?.operationId === op.id && v.nominalJob?.text === op.gcode && <p className="hint" role="status">
          Loaded in Toolpath.{v.prefs.layers?.toolpaths === false ? ' Cutting paths are hidden; enable them in Toolpath Layers.' : ''}
        </p>}
        <div className="seg"><button disabled={busy} onClick={() => onLoad(op)}>
          {v.job?.operationId === op.id && v.nominalJob?.text === op.gcode ? 'Reload G-code' : 'Load G-code'}
        </button><button onClick={() => downloadCamFile(op.filename, op.gcode)}>Save G-code</button></div>
      </div>)}
    </div>
    <div className="seg"><button onClick={() => downloadCamFile('millproject', result.millproject)}>Save millproject</button>
      <button onClick={() => downloadCamFile('pcb-cam.json', JSON.stringify({ format: 'pcb-cnc-cam', version: 1, ...result }, null, 2), 'application/json')}>Save CAM bundle</button></div>
    <details><summary>Generation log</summary><pre className="cam-log">{result.stdout}{result.stderr}</pre></details>
  </>;
}
