import { Suspense, useEffect, useState } from 'react';
import { useStoreSelector, stateColor } from './cnc/runtime.js';
import SettingsModal from './settings/SettingsModal.jsx';
import DockShell from './DockShell.jsx';
import ConnectPromptModal from './widgets/ConnectPromptModal.jsx';
import StatusFooter from './widgets/StatusFooter.jsx';
import ToastHost from './ui/ToastHost.jsx';
import StepGuideModal from './widgets/StepGuideModal.jsx';
import ProbeWiringModal from './widgets/ProbeWiringModal.jsx';
import { bindReconciler } from './workflow/reconcile.js';
import { MODES, MODE_IDS, loadMode, saveMode } from './modes/modeRegistry.js';
import './app.css';

// Own subscription so a status tick re-renders the header only.
// App itself must NOT subscribe: it is the parent of every widget, and a
// parent re-render bypasses the widgets' selectors and rebuilds both lists.
function HeaderStatus() {
  const activeState = useStoreSelector((s) => s.activeState);
  const connectedPort = useStoreSelector((s) => s.connectedPort);
  return (
    <span className={`tag ${stateColor(activeState)}`}>
      {connectedPort ? activeState ?? '—' : 'port closed'}
    </span>
  );
}

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Startup prompt once per page load, and only when the session starts in
  // Debug mode — Guided's stage 1 + MachinePanel already own connection there.
  const [connectPrompt, setConnectPrompt] = useState(() => {
    try {
      const autoConnect = JSON.parse(localStorage.getItem('pcb-cnc.defaults.v1') || '{}')?.connection?.autoConnect;
      return loadMode() === 'debug' && !autoConnect;
    } catch { return loadMode() === 'debug'; }
  });
  const [mode, setMode] = useState(loadMode);

  useEffect(() => { saveMode(mode); }, [mode]);

  // Machine→session reconciliation (stage completion from real activity) +
  // step-guide narration — app-wide, every UI mode (StrictMode-safe).
  useEffect(() => { bindReconciler(); }, []);

  // Ctrl/Cmd+1/2/3 mode switching (ui-modes.md §8)
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const idx = ['1', '2', '3'].indexOf(e.key);
      if (idx >= 0) { e.preventDefault(); setMode(MODE_IDS[idx]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const ActiveMode = mode === 'debug' ? null : MODES[mode].component;

  return (
    <div className={`app mode-${mode}`}>
      <header className="app-header">
        <h1>PCB CNC</h1>
        <div className="mode-switcher" role="tablist" aria-label="UI mode">
          {MODE_IDS.map((id, i) => (
            <button
              key={id}
              role="tab"
              aria-selected={mode === id}
              className={`mode-btn ${mode === id ? 'on' : ''}`}
              onClick={() => setMode(id)}
              title={`${MODES[id].title} (Ctrl/Cmd+${i + 1})`}
            >
              <span className="mode-icon">{MODES[id].icon}</span>
              <span>{MODES[id].title}</span>
            </button>
          ))}
        </div>
        <HeaderStatus />
        <span className="spacer" />
        <button onClick={() => setSettingsOpen(true)} aria-haspopup="dialog">Settings</button>
      </header>
      {mode === 'debug' ? (
        <DockShell />
      ) : (
        <Suspense fallback={<div className="mode-loading">loading {MODES[mode].title}…</div>}>
          <ActiveMode />
        </Suspense>
      )}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ConnectPromptModal open={connectPrompt} onCancel={() => setConnectPrompt(false)} />
      <StepGuideModal />
      <ProbeWiringModal />
      <StatusFooter />
      <ToastHost />
    </div>
  );
}
