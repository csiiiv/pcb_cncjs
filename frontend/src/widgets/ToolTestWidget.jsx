import ToolProfilePicker from '../tools/ToolProfilePicker.jsx';
import { profileFromTest, saveToolProfile, profileIsolationSettings } from '../tools/profiles.js';
import { ParameterLabel } from '../ui/InfoIcon.jsx';
import { useState } from 'react';
import { getDefaults } from '../settings/store.js';
import { TOOL_TEST_FIELDS, toolTestErrors, TOOL_TEST_PATTERNS, COMPARISON_ANGLES } from '../tooltest/config.js';
import { generateToolTest } from '../tooltest/generate.js';
import { loadCamOperation, downloadCamFile } from '../cam/preview.js';
import { getCam, setCam } from '../cam/store.js';
import { store, useStoreSelector } from '../cnc/runtime.js';
import { useViz } from '../visualizer/vizStore.js';
import NumField from '../ui/NumField.jsx';
import { parameterHelp } from '../ui/parameterHelp.js';

export default function ToolTestWidget() {
  const [settings, setSettings] = useState(() => getDefaults('tooltest'));
  const [result, setResult] = useState(null);
  const [selected, setSelected] = useState(null);
  const [width, setWidth] = useState(0);
  const [profileName, setProfileName] = useState('');
  const [notes, setNotes] = useState('');
  const [measured, setMeasured] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const busy = useStoreSelector(s => ['running', 'paused'].includes(s.workflowState));
  const v = useViz();
  const errors = toolTestErrors(settings);
  const stale = result && JSON.stringify(settings) !== JSON.stringify(result.settings);
  const sample = result?.samples.find(row => row.index === selected);
  const field = key => value => { setSettings(s => ({ ...s, [key]: value })); setMessage(null); };
  const generate = () => {
    try { setResult(generateToolTest(settings)); setSelected(null); setMessage(null); setError(null); }
    catch (err) { setError(err.message); }
  };
  const load = () => {
    if (['running', 'paused'].includes(store.getSnapshot().workflowState)) return;
    try { loadCamOperation(result); setError(null); }
    catch (err) { setError(err.message); }
  };
  const calibration = () => profileFromTest({ name: profileName || 'Test sample', notes, result, sample, diameter: width, measured });
  const useIsolation = () => {
    try {
      setCam({ settings: profileIsolationSettings(getCam().settings, calibration()) });
      setMessage(`CAM isolation set to Z ${sample.depth} mm and tool diameter ${width} mm. Generate CAM toolpaths again to use it.`);
      setError(null);
    } catch (err) { setError(err.message); }
  };
  const saveProfile = () => {
    try {
      if (!profileName.trim()) throw new Error('Enter a profile name.');
      const saved = saveToolProfile(calibration());
      setMessage(`Saved tool profile “${saved.name}”. Select it in PCB CAM to reuse the calibration.`);
      setError(null);
    } catch (err) { setError(err.message); }
  };
  return <section className="widget tool-test-widget">
    <h2>Tool Test</h2>
    <p className="hint">Test copper trace widths across depth sections, compare assumed bit angles using 10 mil traces, or cut separate depth grooves. Inspect clearance and measure a reference groove. Set work XY0 on the test area and work Z0 on its surface.</p>
    <details open={!result}><summary>Test setup</summary>
      <label className="tool-test-pattern"><ParameterLabel label="Test pattern" help={parameterHelp('tooltest', 'pattern')} />
        <select value={settings.pattern} onChange={event => field('pattern')(event.target.value)}>
          {TOOL_TEST_PATTERNS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
      {settings.pattern === 'angles' && <p className="hint">Six 10 mil traces assume {COMPARISON_ANGLES.join(', ')}° included angles, all using the tip diameter below. Each row progresses from shallow to deep along +X.</p>}
      <div className="probe-fields cols-2">{TOOL_TEST_FIELDS.filter(([key]) => settings.pattern !== 'angles' || key !== 'angle').map(([key, label]) =>
        <NumField key={key} label={label} help={parameterHelp('tooltest', key)} value={settings[key]} onChange={field(key)} />)}</div>
    </details>
    {errors.length > 0 && <div className="error" role="alert">{errors.map(text => <p key={text}>{text}</p>)}</div>}
    <button disabled={errors.length > 0} onClick={generate}>Generate test G-code</button>
    {error && <div className="error" role="alert">{error}</div>}
    {result && <>
      {stale && <p className="hint">Setup changed. The table and G-code below belong to the previous generation.</p>}
      <p className="hint">{new Set(result.samples.map(row => row.depth)).size} depth samples · X {result.layout.minX} to {result.layout.maxX} mm · Y {result.layout.minY} to {result.layout.maxY} mm. Allow extra room for the groove width.</p>
      <p className="hint">Geometric width = tip + 2 × |depth| × tan(angle/2). Actual width also depends on runout, tool shape and surface height.</p>
      <div className="seg"><button disabled={busy} onClick={load}>
        {v.job?.operationId === result.id && v.nominalJob?.text === result.gcode ? 'Reload G-code' : 'Load G-code'}</button>
        <button onClick={() => downloadCamFile(result.filename, result.gcode)}>Save G-code</button></div>
      <p className="hint">Inspect the loaded test in Toolpath, then use Job Runner to load it into the sender and start it.</p>
      {result.settings.pattern === 'coupon' && <p className="hint">Traces run in +X, ordered 5, 10, 15, 20 mil from lower to higher Y (0.127, 0.254, 0.381, 0.508 mm). Depth increases across equal X sections. Ticks below the traces mark boundaries; every fifth tick is longer. Measure the reference groove above the traces inside each section, away from the depth transitions.</p>}
      {result.settings.pattern === 'angles' && <p className="hint">All traces target 10 mil (0.254 mm). From lower to higher Y, rows assume {COMPARISON_ANGLES.join(', ')}° included angles. Compare retained copper width inside each section with a known 10 mil trace. Matching width suggests a geometry hypothesis; check complete clearance too. Ticks mark depth boundaries. Each boundary groove uses its row’s assumed cutter width; there is no separate reference groove.</p>}
      <div className="tool-test-table"><table className="kv"><thead><tr><th>{result.settings.pattern !== 'grooves' ? 'Section' : 'Row'}</th><th>{result.settings.pattern !== 'grooves' ? 'X (mm)' : 'Y (mm)'}</th>{result.settings.pattern === 'angles' && <th>Angle / Y</th>}<th>Z (mm)</th><th>Est. width (mm)</th><th /></tr></thead>
        <tbody>{result.samples.map(row => <tr key={row.index} className={selected === row.index ? 'chosen' : ''}>
          <td>{row.section ?? row.index}</td><td>{result.settings.pattern !== 'grooves' ? `${row.x}–${row.xEnd}` : row.y}</td>{result.settings.pattern === 'angles' && <td>{row.angle}° / {row.y}</td>}<td>{row.depth}</td><td>{row.width.toFixed(3)}</td>
          <td><button aria-pressed={selected === row.index} onClick={() => { setSelected(row.index); setWidth(Number(row.width.toFixed(6))); setMeasured(false); setProfileName(name => result.settings.pattern === 'angles' || !name ? `${row.angle ?? result.settings.angle}° V-bit / ${result.settings.tip} mm tip` : name); setMessage(null); }}>Choose</button></td>
        </tr>)}</tbody></table></div>
      {sample && <>
        <p className="hint">{result.settings.pattern !== 'grooves' ? 'Section' : 'Row'} {sample.section ?? sample.index}{sample.angle != null ? ` / ${sample.angle}° assumed angle` : ''} at Z {sample.depth} mm selected. The width below starts with the estimate; replace it with your measured groove width.</p>
        <NumField label="Effective width (mm)" help="Diameter to use for CAM isolation at the chosen depth. Enter the measured width of a fully cleared groove; the initial value is only the geometric estimate." value={width} onChange={setWidth} />
        <label className="check-label"><input type="checkbox" checked={measured} onChange={event => setMeasured(event.target.checked)} />
          <ParameterLabel label="Width measured on this coupon" help="Mark this only after measuring the groove cut at the selected depth. Saved profiles show whether their width was measured or estimated." /></label>
        <div className="tool-profile-fields">
          <label><ParameterLabel label="Profile name" help="Name for this tool calibration. Saving an existing name updates that profile." /><input type="text" maxLength={80} value={profileName} onChange={event => setProfileName(event.target.value)} /></label>
          <label><ParameterLabel label="Material / notes" help="Record the coupon material, copper thickness and any observations relevant to reusing this calibration." /><textarea maxLength={1000} value={notes} onChange={event => setNotes(event.target.value)} /></label>
        </div>
        <button disabled={!profileName.trim() || !Number.isFinite(width) || width <= 0 || width > 1000000} onClick={saveProfile}>Save tool profile</button>
        <button disabled={!Number.isFinite(width) || width <= 0 || width > 1000000} onClick={useIsolation}>Use for CAM isolation</button>
      </>}
    </>}
    <details><summary>Saved tool profiles</summary><ToolProfilePicker /></details>
    {message && <p className="hint" role="status">{message}</p>}
  </section>;
}
