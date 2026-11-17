import { ParameterLabel } from '../ui/InfoIcon.jsx';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ResizeEdge, useModalStack, useModalWidth, isTopModal } from '../ui/ModalKit.jsx';
import NumField from '../ui/NumField.jsx';
import { SETTINGS_TABS, FACTORY_DEFAULTS, getPath, setPath, settingsErrors } from './schema.js';
import { getAllDefaults, saveDefaults } from './store.js';

export default function SettingsModal({ open, onClose }) {
  const [draft, setDraft] = useState(getAllDefaults);
  const [tabId, setTabId] = useState('connection');
  const [error, setError] = useState(null);
  const [width, setWidth] = useModalWidth('settings', 560);
  useModalStack(open, 'settings');
  useEffect(() => { if (open) { setDraft(getAllDefaults()); setError(null); } }, [open]);
  useEffect(() => {
    if (!open) return;
    const key = event => { if (event.key === 'Escape' && isTopModal('settings')) onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open, onClose]);
  if (!open) return null;
  const tab = SETTINGS_TABS.find(item => item.id === tabId);
  const errors = settingsErrors(draft);
  const change = (path, value) => setDraft(current => {
    const next = structuredClone(current);
    setPath(next[tabId], path, value);
    return next;
  });
  const field = item => {
    const value = getPath(draft[tabId], item.key);
    if (item.type === 'number') return <NumField key={item.key} label={item.label} help={item.help} value={value} onChange={next => change(item.key, next)} />;
    if (item.type === 'boolean') return <label className="check-label" key={item.key}><input type="checkbox" checked={value}
      onChange={event => change(item.key, event.target.checked)} /><ParameterLabel label={item.label} help={item.help} /></label>;
    if (item.type === 'select') return <label key={item.key}><ParameterLabel label={item.label} help={item.help} /><select value={value} onChange={event => {
      const option = item.options.find(([id]) => String(id) === event.target.value);
      change(item.key, option[0]);
    }}>{item.options.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>;
    return <label key={item.key}><ParameterLabel label={item.label} help={item.help} /><input type="text" value={value} onChange={event => change(item.key, event.target.value)} /></label>;
  };
  const save = () => {
    try { saveDefaults(draft); onClose(); }
    catch (err) { setError(err.message); }
  };
  return createPortal(<div className="modal-backdrop side settings-modal" style={{ width: `min(${width}px, 100vw)` }} onMouseDown={onClose}>
    <div className="modal-panel" role="dialog" aria-labelledby="settings-title" onMouseDown={event => event.stopPropagation()}>
      <ResizeEdge width={width} setWidth={setWidth} />
      <div className="modal-head"><h2 id="settings-title">Component defaults</h2><span className="spacer" />
        <button aria-label="Close settings" onClick={onClose}>×</button></div>
      <div className="settings-tabs" role="tablist" aria-label="Component settings">
        {SETTINGS_TABS.map(item => <button key={item.id} id={`settings-tab-${item.id}`} role="tab"
          tabIndex={item.id === tabId ? 0 : -1}
          onKeyDown={event => {
            const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
            if (!keys.includes(event.key)) return;
            event.preventDefault();
            const index = SETTINGS_TABS.findIndex(candidate => candidate.id === item.id);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? SETTINGS_TABS.length - 1
              : (index + (event.key === 'ArrowRight' ? 1 : -1) + SETTINGS_TABS.length) % SETTINGS_TABS.length;
            setTabId(SETTINGS_TABS[next].id);
            document.getElementById(`settings-tab-${SETTINGS_TABS[next].id}`)?.focus();
          }}
          aria-selected={item.id === tabId} aria-controls="settings-panel" className={item.id === tabId ? 'on' : ''}
          onClick={() => setTabId(item.id)}>{item.title}</button>)}
      </div>
      <div className="modal-body" id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${tabId}`}>
        <p className="hint">Saved defaults take effect on the next page load. Adjust component controls as needed for each job. Values are saved in this browser.</p>
        <h3>{tab.title}</h3>
        {tab.help && <p className="hint">{tab.help}</p>}
        <div key={tabId}>
          {(tab.groups || [{ fields: tab.fields }]).map((group, index) => <section key={index} className="settings-group">
            {group.title && <h4>{group.title}</h4>}
            <div className="settings-fields">{group.fields.map(field)}</div>
          </section>)}
        </div>
        {errors.length > 0 && <div className="error" role="alert">{errors.map((message, i) => <p key={i}>{message}</p>)}</div>}
        {error && <div className="error" role="alert">{error}</div>}
      </div>
      <div className="modal-foot"><button onClick={() => setDraft(current => ({ ...current, [tabId]: structuredClone(FACTORY_DEFAULTS[tabId]) }))}>Reset this tab</button>
        <span className="spacer" /><button onClick={onClose}>Cancel</button><button disabled={errors.length > 0} onClick={save}>Save defaults</button></div>
    </div>
  </div>, document.body);
}
