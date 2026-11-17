import { useState } from 'react';
import { useToolProfiles, profileIsolationSettings } from './profiles.js';
import { getCam, setCam } from '../cam/store.js';
import { ParameterLabel } from '../ui/InfoIcon.jsx';

export default function ToolProfilePicker({ disabled = false }) {
  const profiles = useToolProfiles();
  const [id, setId] = useState('');
  const [message, setMessage] = useState(null);
  const profile = profiles.find(item => item.id === id);
  if (!profiles.length) return <p className="hint">Save a calibration in Tool Test to reuse it as a tool profile here.</p>;
  const apply = () => {
    try { setCam({ settings: profileIsolationSettings(getCam().settings, profile), error: null }); setMessage('Profile applied. Generate toolpaths again to use these settings.'); }
    catch (error) { setCam({ error }); }
  };
  return <div className="tool-profile-picker">
    <label><ParameterLabel label="Tool profile" help="Saved V-bit calibration. Applying it sets CAM isolation depth, effective tool diameter, cutting/plunge feeds and spindle RPM. Isolation width is increased if needed to fit the tool." />
      <select disabled={disabled} value={id} onChange={event => { setId(event.target.value); setMessage(null); }}>
        <option value="">Choose a profile</option>
        {profiles.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
    {profile && <p className="hint">{profile.angle}° · tip {profile.tip} mm · Z {profile.depth} mm · Ø {profile.diameter} mm · F {profile.feed} mm/min · plunge {profile.plunge} mm/min · {profile.rpm} RPM · {profile.measured ? 'Measured width' : 'Estimated width'}
      {profile.notes && <> · {profile.notes}</>}</p>}
    <button disabled={disabled || !profile} onClick={apply}>Apply to CAM isolation</button>
    {message && <p className="hint" role="status">{message}</p>}
  </div>;
}
