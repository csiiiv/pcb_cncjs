// Guided steps 2–3 — import sources + generate toolpaths, distilled into
// one consistent panel (the Debug CAM wizard stays for expert use).
// Same CamClient/store/loadCamOperation underneath; stage completion is
// reconciled by workflow/reconcile.js from the cam store.
import { useEffect, useMemo, useState } from 'react';
import { CamClient } from '../../cam/client.js';
import { getCam, setCam, useCam } from '../../cam/store.js';
import { readCamArchive } from '../../cam/archive.js';
import { CAM_SOURCES, CAM_FIELDS, camStepErrors } from '../../cam/setup.js';
import { parameterHelp } from '../../ui/parameterHelp.js';
import NumField from '../../ui/NumField.jsx';
import { connection } from '../../cnc/runtime.js';

const client = new CamClient(connection);

export default function StepCam({ stage, done }) {
  const cam = useCam();
  const [status, setStatus] = useState(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState(null);
  const isImport = stage === 'imported';

  useEffect(() => {
    client.status().then(setStatus).catch((err) => setStatus({ available: false, message: err.message }));
  }, []);

  const importFile = async (role, file) => {
    if (!file) return;
    setReading(true); setError(null);
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('PCB source files must be smaller than 5 MB');
      const content = await file.text();
      if (!content.trim() || content.includes('\0')) throw new Error('Import a non-empty Gerber or Excellon text file');
      setCam({ files: { ...getCam().files, [role]: { name: file.name, content } }, error: null });
    } catch (err) {
      setCam({ error: err }); setError(err.message);
    } finally {
      setReading(false);
    }
  };

  const importZip = async (file) => {
    if (!file) return;
    setReading(true); setError(null);
    try {
      if (file.size > 25 * 1024 * 1024) throw new Error('PCB ZIP files must be smaller than 25 MB.');
      const { entries, files } = readCamArchive(new Uint8Array(await file.arrayBuffer()));
      setCam({ archive: { name: file.name, entries }, files, error: null });
    } catch (err) {
      setCam({ error: err }); setError(err.message);
    } finally {
      setReading(false);
    }
  };

  const removeSource = (role) => {
    const files = { ...getCam().files };
    delete files[role];
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
    if (errors.length) { setCam({ error: new Error(errors.join(' ')) }); setError(errors.join(' ')); return false; }
    setCam({ generating: true, error: null });
    try {
      const result = await client.generate(files, settings);
      setCam({ result });
      setStatus({ available: true, version: result.version });
      return true;
    } catch (err) {
      setCam({ error: err }); setError(err.message);
      return false;
    } finally {
      setCam({ generating: false });
    }
  };

  const stale = useMemo(() => cam.result && (JSON.stringify(cam.files) !== JSON.stringify(Object.fromEntries(
    Object.entries(cam.result.sources).map(([role, file]) => [role, { name: file.name, content: file.content }])
  )) || JSON.stringify(cam.settings) !== JSON.stringify(cam.result.settings)), [cam.files, cam.settings, cam.result]);

  const fileCount = Object.keys(cam.files || {}).length;
  // sections with a matching source: common always (it applies to all)
  const sections = useMemo(() => ['common', ...CAM_SOURCES.filter(({ role }) => cam.files[role]).map(({ section }) => section)], [cam.files]);

  return (
    <div className="gw-step">
      <p className="gw-status">
        <span className={`tag ${fileCount ? 'ok' : ''}`}>{fileCount} source{fileCount === 1 ? '' : 's'}</span>
        <span className={`tag ${status?.available ? 'ok' : ''}`}>{status?.available ? `pcb2gcode ${String(status.version).split('\n')[0]}` : status ? 'CAM unavailable' : 'checking engine…'}</span>
        {cam.result && <span className="tag ok">{cam.result.operations.length} operations</span>}
        {stale && <span className="tag warn">changed — regenerate</span>}
      </p>

      {isImport ? (
        <>
          <p className="hint">Fab ZIP is easiest — layers are matched automatically. At least front copper is required; drill and outline recommended.</p>
          <label className="gw-file">
            <span className="label">Gerber/drill ZIP</span>
            <input type="file" accept=".zip,application/zip" disabled={reading} onChange={(e) => { importZip(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {cam.archive && <p className="hint">From {cam.archive.name}: matched layers below.</p>}
          <div className="gw-sources">
            {CAM_SOURCES.map(({ role, label, accept }) => (
              <div key={role} className={`gw-source ${cam.files[role] ? 'has' : ''}`}>
                <span className="gw-source-name">{label}</span>
                {cam.files[role] ? (
                  <span className="gw-source-file">
                    <code>{cam.files[role].name}</code>
                    <button aria-label={`Remove ${label}`} disabled={reading} onClick={() => removeSource(role)}>×</button>
                  </span>
                ) : (
                  <input type="file" accept={accept} disabled={reading} onChange={(e) => { importFile(role, e.target.files?.[0]); e.target.value = ''; }} />
                )}
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="hint">Tool diameters drive isolation quality — a measured V-bit width beats the datasheet.</p>
          {sections.map((section) => (
            <fieldset key={section} className="gw-fields" disabled={cam.generating}>
              <legend>{section === 'common' ? 'Board' : CAM_SOURCES.find((s) => s.section === section)?.title}</legend>
              <div className="probe-fields cols-2">
                {CAM_FIELDS[section].map(([key, label]) => (
                  <NumField key={`${section}-${key}`} label={label} help={parameterHelp('cam', `${section}.${key}`)}
                    value={cam.settings[section][key]} onChange={(value) => field(section, key, value)} />
                ))}
              </div>
            </fieldset>
          ))}
          <button className="primary" disabled={cam.generating || !fileCount} onClick={generate}>
            {cam.generating ? 'Generating…' : 'Generate toolpaths'}
          </button>
        </>
      )}

      {error && <div className="error">{error}</div>}

      {cam.result && !isImport && (
        <p className="hint">
          ✓ {cam.result.operations.length} operations generated — continue to <b>Select toolpath</b> to preview and load one.
        </p>
      )}
      {done && isImport && <p className="hint">Sources loaded. Continue to generate.</p>}
    </div>
  );
}
