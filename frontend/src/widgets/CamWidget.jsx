import ToolProfilePicker from '../tools/ToolProfilePicker.jsx';
import { useEffect, useMemo, useState } from 'react';
import { connection, store, useStoreSelector } from '../cnc/runtime.js';
import { CamClient } from '../cam/client.js';
import { getCam, setCam, useCam } from '../cam/store.js';
import { loadCamOperation } from '../cam/preview.js';
import { readCamArchive } from '../cam/archive.js';
import CamResults from '../cam/CamResults.jsx';
import { CAM_SOURCES, camStepErrors } from '../cam/setup.js';
import CamSetupModal from './CamSetupModal.jsx';

const client = new CamClient(connection);
export default function CamWidget() {
  const cam = useCam();
  const workflow = useStoreSelector((s) => s.workflowState);
  const busy = workflow === 'running' || workflow === 'paused';
  const [status, setStatus] = useState(null);
  const [open, setOpen] = useState(false);
  const [initialStep, setInitialStep] = useState('files');
  const [reading, setReading] = useState(false);

  const checkStatus = async () => {
    try { setStatus(await client.status()); }
    catch (err) { setStatus({ available: false, message: err.message }); }
  };
  useEffect(() => { checkStatus(); }, []);

  const importFile = async (role, file) => {
    if (!file) return;
    setReading(true);
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('PCB source files must be smaller than 5 MB');
      const content = await file.text();
      if (!content.trim() || content.includes('\0')) throw new Error('Import a non-empty Gerber or Excellon text file');
      setCam({ files: { ...getCam().files, [role]: { name: file.name, content } }, error: null });
    } catch (err) { setCam({ error: err }); }
    finally { setReading(false); }
  };
  const importZip = async (file) => {
    if (!file) return;
    setReading(true);
    try {
      if (file.size > 25 * 1024 * 1024) throw new Error('PCB ZIP files must be smaller than 25 MB.');
      const { entries, files } = readCamArchive(new Uint8Array(await file.arrayBuffer()));
      setCam({ archive: { name: file.name, entries }, files, error: null });
    } catch (err) { setCam({ error: err }); }
    finally { setReading(false); }
  };
  const selectSource = (role, name) => {
    const current = getCam();
    const entry = current.archive?.entries.find((item) => item.name === name);
    const files = { ...current.files };
    if (entry) files[role] = { name: entry.name, content: entry.content };
    else delete files[role];
    setCam({ files, error: null });
  };
  const field = (section, key, value) => {
    const current = getCam().settings;
    setCam({ settings: { ...current, [section]: { ...current[section], [key]: value } } });
  };
  const generate = async () => {
    if (getCam().generating) return false;
    const { files, settings } = getCam();
    const errors = camStepErrors('review', files, settings);
    if (errors.length) { setCam({ error: new Error(errors.join(' ')) }); return false; }
    setCam({ generating: true, error: null });
    try {
      const result = await client.generate(files, settings);
      setCam({ result });
      setStatus({ available: true, version: result.version });
      return true;
    } catch (err) { setCam({ error: err }); return false; }
    finally { setCam({ generating: false }); }
  };
  const load = (op) => {
    if (['running', 'paused'].includes(store.getSnapshot().workflowState)) return;
    try { loadCamOperation(op); setCam({ error: null }); setOpen(false); }
    catch (err) { setCam({ error: err }); }
  };
  const stale = useMemo(() => cam.result && (JSON.stringify(cam.files) !== JSON.stringify(Object.fromEntries(
    Object.entries(cam.result.sources).map(([role, file]) => [role, { name: file.name, content: file.content }])
  )) || JSON.stringify(cam.settings) !== JSON.stringify(cam.result.settings)), [cam.files, cam.settings, cam.result]);

  const remove = (role) => {
    const files = { ...getCam().files }; delete files[role]; setCam({ files, error: null });
  };
  const showSetup = (step) => { setInitialStep(step); setOpen(true); };

  return (
    <section className="widget cam-widget">
      <h2>PCB CAM</h2>
      <div className="row">
        <span className={`tag ${status?.available ? 'ok' : ''}`}>{status?.available ? `pcb2gcode ${status.version.split('\n')[0]}` : status ? 'CAM unavailable' : 'Checking engine…'}</span>
        <button onClick={checkStatus} disabled={cam.generating}>Check engine</button>
      </div>
      {status && !status.available && <div className="hint">{status.message}</div>}
      <ToolProfilePicker disabled={cam.generating} />
      <p className="hint">Set up source files, board clearance and cutting settings step by step.</p>
      {CAM_SOURCES.filter(({ role }) => cam.files[role]).map(({ role, label }) =>
        <div className="cam-source-name" key={role}><span>{label}: {cam.files[role].name}</span></div>)}
      <div className="seg cam-setup-actions">
        <button disabled={cam.generating || reading} onClick={() => showSetup('files')}>
          {Object.keys(cam.files).length ? 'Edit setup' : 'Setup CAM'}</button>
        {cam.result && <button disabled={cam.generating || reading} onClick={() => showSetup('review')}>Generate again</button>}
      </div>
      {cam.generating && <p className="hint" role="status">Generating toolpaths…</p>}
      {!open && cam.error && <div className="error" role="alert">{cam.error.message}
        {(cam.error.stderr || cam.error.stdout) && <pre className="cam-log">{cam.error.stderr || cam.error.stdout}</pre>}
      </div>}
      {cam.result && <CamResults result={cam.result} stale={stale} busy={busy} onLoad={load} />}
      <CamSetupModal open={open} initialStep={initialStep} onClose={() => setOpen(false)}
        cam={cam} status={status} reading={reading} stale={stale} busy={busy}
        onCheck={checkStatus} onImportZip={importZip} onSelectSource={selectSource} onImport={importFile} onRemove={remove} onField={field}
        onGenerate={generate} onLoad={load} />
    </section>
  );
}
