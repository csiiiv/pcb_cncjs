import ToolProfilePicker from '../tools/ToolProfilePicker.jsx';
import { ParameterLabel } from '../ui/InfoIcon.jsx';
import { parameterHelp, sourceHelp } from '../ui/parameterHelp.js';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ResizeEdge, useModalStack, useModalWidth, isTopModal } from '../ui/ModalKit.jsx';
import NumField from '../ui/NumField.jsx';
import CamResults from '../cam/CamResults.jsx';
import { CAM_SOURCES, CAM_FIELDS, camSetupSteps, camStepErrors } from '../cam/setup.js';

const HELP = {
  common: 'Choose a shared XY origin and clearance above the PCB. All Z values refer to the PCB surface at work Z0.',
  isolation: 'Set the effective diameter of your isolation bit at the chosen depth. Isolation width controls how much copper is cleared.',
  drilling: 'Choose drilling depth, feed and spindle speed. Each drill size in the Excellon file becomes a separate toolpath.',
  outline: 'Choose the end mill, total cut depth and depth per pass. Holding tabs keep the board attached; set tab width to 0 to omit them.'
};

export default function CamSetupModal({ open, initialStep, onClose, cam, status, reading, stale, busy,
  onCheck, onImportZip, onSelectSource, onImport, onRemove, onField, onGenerate, onLoad }) {
  const [stepId, setStepId] = useState('files');
  const [width, setWidth] = useModalWidth('cam-setup', 500);
  useModalStack(open, 'cam-setup');
  useEffect(() => { if (open) setStepId(initialStep); }, [open, initialStep]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event) => {
      if (event.key === 'Escape' && isTopModal('cam-setup')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;

  const steps = camSetupSteps(cam.files);
  const index = Math.max(0, steps.findIndex(({ id }) => id === stepId));
  const step = steps[index];
  const locked = cam.generating || reading;
  const errors = camStepErrors(step.id, cam.files, cam.settings);
  const generate = async () => { if (await onGenerate()) setStepId('results'); };
  const fields = (section) => <div className="probe-fields cols-2">
    {CAM_FIELDS[section].map(([key, label]) => <NumField key={`${section}-${key}`} label={label} help={parameterHelp('cam', `${section}.${key}`)}
      value={cam.settings[section][key]} onChange={(value) => onField(section, key, value)} />)}
  </div>;

  return createPortal(
    <div className="modal-backdrop side cam-setup" style={{ width: `min(${width}px, 100vw)` }} onMouseDown={onClose}>
      <div className="modal-panel cam-widget" role="dialog" aria-label="PCB CAM setup" onMouseDown={(event) => event.stopPropagation()}>
        <ResizeEdge width={width} setWidth={setWidth} />
        <div className="modal-head"><h2>PCB CAM setup</h2><span className="spacer" />
          <button onClick={onClose} aria-label="Close PCB CAM setup">×</button></div>
        <nav className="cam-step-nav" aria-label="CAM setup steps">
          {steps.map((item, i) => <button key={item.id} aria-current={item.id === step.id ? 'step' : undefined}
            disabled={locked || i > index || (item.id === 'results' && !cam.result)}
            onClick={() => setStepId(item.id)}><span>{i + 1}</span>{item.title}</button>)}
        </nav>
        <div className="modal-body">
          <h3>Step {index + 1} — {step.title}</h3>
          {cam.error && <div className="error" role="alert">{cam.error.message}
            {(cam.error.stderr || cam.error.stdout) && <pre className="cam-log">{cam.error.stderr || cam.error.stdout}</pre>}</div>}
          {step.id === 'files' && <>
            <p className="hint">Import the files for the operations you need. Unused operations are skipped. Include the outline when it defines the board’s reference extents.</p>
            <div className="cam-sources">
              <label><ParameterLabel label="Gerber ZIP" help={sourceHelp('zip')} /><input type="file" accept=".zip,application/zip" disabled={locked}
                onChange={(event) => { onImportZip(event.target.files?.[0]); event.target.value = ''; }} /></label>
              <p className="hint">ZIP import replaces the selected sources. Review the matched layers below; other layers are skipped.</p>
              {cam.archive && <>
                <b className="cam-source-name">{cam.archive.name}</b>
                <p className="hint">Choose one file per operation, or skip it. Multiple drill files need separate CAM generations; they are not merged.</p>
              </>}
            </div>
            <div className="cam-sources">{CAM_SOURCES.map(({ role, label, accept }) => <div key={role}>
              {cam.archive && <label><ParameterLabel label={`${label} from ZIP`} help={sourceHelp(role)} /><select disabled={locked} value={cam.archive.entries.some((entry) => entry.name === cam.files[role]?.name) ? cam.files[role].name : ''}
                onChange={(event) => onSelectSource(role, event.target.value)}>
                <option value="">{cam.files[role] ? 'Use individually imported file / skip ZIP' : 'Choose a file / skip operation'}</option>
                {cam.archive.entries.filter((entry) => entry.kind === (role === 'drill' ? 'drill' : 'gerber')).map((entry) =>
                  <option key={entry.name} value={entry.name}>{entry.name}</option>)}
              </select></label>}
              {cam.archive && !cam.files[role] && cam.archive.entries.filter((entry) => entry.role === role).length > 1 &&
                <p className="hint">Multiple matching files found. Choose the source for this operation.</p>}
              <label><ParameterLabel label={cam.archive ? 'Or import ' + label.toLowerCase() : label} help={sourceHelp(role)} /><input type="file" accept={accept} disabled={locked}
                onChange={(event) => { onImport(role, event.target.files?.[0]); event.target.value = ''; }} /></label>
              {cam.files[role] && <div className="cam-source-name"><span>{cam.files[role].name}</span>
                <button disabled={locked} aria-label={`Remove ${label}`} onClick={() => onRemove(role)}>×</button></div>}
            </div>)}</div>
            {!Object.keys(cam.files).length && <p className="hint">Import at least one source file to continue.</p>}
          </>}
          {CAM_FIELDS[step.id] && <fieldset disabled={locked}>
            <p className="hint">{HELP[step.id]}</p>
            {step.id === 'isolation' && <ToolProfilePicker disabled={locked} />}
            {fields(step.id)}
            {step.id === 'common' && <label className="check-label"><input type="checkbox" checked={cam.settings.common.zeroStart}
              onChange={(event) => onField('common', 'zeroStart', event.target.checked)} /> <ParameterLabel label="Place board lower-left at work XY0" help={parameterHelp('cam', 'common.zeroStart')} /></label>}
            {step.id === 'drilling' && <p className="hint">Mount the indicated drill bit and set Z before running each generated drilling operation.</p>}
          </fieldset>}
          {step.id === 'review' && <>
            <p className="hint">Review the source files and settings before generating nominal G-code.</p>
            <div className="row"><span className={`tag ${status?.available ? 'ok' : ''}`}>
              {status?.available ? `pcb2gcode ${status.version.split('\n')[0]}` : 'CAM unavailable'}</span>
              <button disabled={locked} onClick={onCheck}>Check engine</button></div>
            {status && !status.available && <p className="hint">{status.message}</p>}
            <p className="hint">Origin: {cam.settings.common.zeroStart ? 'board lower-left at work XY0' : 'original design coordinates'}.</p>
            {[{ section: 'common', title: 'Board setup' }, ...CAM_SOURCES.filter((source) => cam.files[source.role])].map((source) =>
              <section className="cam-review" key={source.section}>
                <h3>{source.title}</h3>{source.role && <p className="hint">{cam.files[source.role].name}</p>}
                <table className="kv"><tbody>{CAM_FIELDS[source.section].map(([key, label]) =>
                  <tr key={key}><td><ParameterLabel label={label} help={parameterHelp('cam', `${source.section}.${key}`)} /></td><td>{cam.settings[source.section][key]}</td></tr>)}</tbody></table>
              </section>)}
            <p className="hint">Generate creates files for inspection. Load G-code to inspect an operation in Toolpath, then use Job Runner to load it into the sender and run it.</p>
          </>}
          {step.id === 'results' && <>
            <p className="hint">Toolpaths are ready. Load G-code to inspect an operation in Toolpath; this closes setup. Check the tool and work reference before machining.</p>
            <CamResults result={cam.result} stale={stale} busy={busy} onLoad={onLoad} />
          </>}
          {step.id !== 'files' && errors.length > 0 && <div className="error" role="alert">{errors.map((error) => <div key={error}>{error}</div>)}</div>}
        </div>
        <div className="modal-foot cam-step-footer">
          <button disabled={locked || index === 0} onClick={() => setStepId(steps[index - 1].id)}>Back</button>
          <span className="hint">{index + 1} / {steps.length}</span><span className="spacer" />
          {step.id === 'review' ? <button disabled={locked || errors.length > 0 || !status?.available} onClick={generate}>
            {cam.generating ? 'Generating…' : 'Generate toolpaths'}</button>
            : step.id === 'results' ? <button onClick={onClose}>Done</button>
              : <button disabled={locked || errors.length > 0} onClick={() => setStepId(steps[index + 1].id)}>Next</button>}
        </div>
      </div>
    </div>, document.body
  );
}
