// Tool Testing mode: calibration home (ui-modes.md §5). Test-type list
// left, preview center, params + machine column right. Reuses the existing
// ToolTestWidget and the probe-quality modals read-only.
import { useEffect, useState } from 'react';
import VisualizerWidget from '../widgets/VisualizerWidget.jsx';
import GcodePreviewWidget from '../widgets/GcodePreviewWidget.jsx';
import ToolTestWidget from '../widgets/ToolTestWidget.jsx';
import MachinePanel from '../widgets/compact/MachinePanel.jsx';
import AutolevelWidget from '../widgets/AutolevelWidget.jsx';
import { takeModeRouting } from './modeRegistry.js';
import { focusWidget } from '../widgets/focus.js';

const TESTS = [
  { id: 'tool', title: 'V-bit tests', icon: '⋀', desc: 'Depth sweep coupon / angle comparison / separate grooves', widget: 'tooltest' },
  { id: 'repeat', title: 'Probe repeatability', icon: '⋰', desc: 'Probe one spot N times — σ / range', widget: 'autolevel' },
  { id: 'compare', title: 'Heightmap compare', icon: '⇄', desc: 'Diff two saved heightmaps for reproducibility', widget: 'autolevel' }
];

const TEST_PREFS_KEY = 'pcb-cnc.test-prefs.v1';

export default function ToolTestingMode() {
  const [selected, setSelected] = useState(() => {
    try { return JSON.parse(localStorage.getItem(TEST_PREFS_KEY) || '"tool"'); } catch { return 'tool'; }
  });
  const [gcodeCollapsed, setGcodeCollapsed] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(TEST_PREFS_KEY, JSON.stringify(selected)); } catch { /* ignore */ }
    const pending = takeModeRouting();
    if (pending.focusWidget) {
      const match = TESTS.find((t) => t.widget === pending.focusWidget);
      if (match) setSelected(match.id);
      requestAnimationFrame(() => focusWidget(pending.focusWidget));
    }
  }, [selected]);

  const test = TESTS.find((t) => t.id === selected) ?? TESTS[0];

  return (
    <div className="test-mode">
      <aside className="test-left">
        <nav className="test-list" aria-label="Test types">
          {TESTS.map((t) => (
            <button key={t.id} className={`test-entry ${t.id === selected ? 'on' : ''}`} onClick={() => setSelected(t.id)}>
              <span className="te-icon">{t.icon}</span>
              <span className="te-body">
                <span className="te-title">{t.title}</span>
                <span className="te-desc">{t.desc}</span>
              </span>
            </button>
          ))}
        </nav>
        <p className="hint" style={{ padding: '0 10px' }}>
          Calibrate here, then apply saved profiles in Guided/Debug CAM. Saved
          tool profiles persist independent of modes.
        </p>
      </aside>

      <main className="test-center">
        <div className="gc-viz"><VisualizerWidget /></div>
        <div className={`gc-gcode ${gcodeCollapsed ? 'collapsed' : ''}`}>
          <button className="gc-gcode-toggle" aria-expanded={!gcodeCollapsed}
            onClick={() => setGcodeCollapsed((v) => !v)}>
            G-code {gcodeCollapsed ? '▸' : '▾'}
          </button>
          {!gcodeCollapsed && (
            <div className="gc-gcode-body"><GcodePreviewWidget /></div>
          )}
        </div>
      </main>

      <aside className="test-right">
        <MachinePanel />
        <div className="test-panel">
          {test.id === 'tool' && <ToolTestWidget />}
          {test.id === 'repeat' && <RepeatPanel />}
          {test.id === 'compare' && <ComparePanel />}
        </div>
      </aside>
    </div>
  );
}

// Probe-quality panels: thin launchers over the Autolevel widget's modals.
// The AutolevelWidget already mounts both modals and exposes its Setup
// button; here we render it and hint at the relevant button.
function RepeatPanel() {
  return (
    <div className="panel-hint">
      <b>Probe repeatability</b>
      Open <b>Autolevel → Test…</b> to configure attempts and run the spot
      repeatability test. Results (σ / range) stay in the modal; the probe
      mesh itself is untouched.
      <AutolevelWidget />
    </div>
  );
}

function ComparePanel() {
  return (
    <div className="panel-hint">
      <b>Heightmap compare</b>
      Open <b>Autolevel → Compare…</b> to diff two saved heightmap files.
      <AutolevelWidget />
    </div>
  );
}
