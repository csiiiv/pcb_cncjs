import { useStoreSelector, stateColor } from './cnc/runtime.js';
import DockShell from './DockShell.jsx';
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
  return (
    <div className="app">
      <header className="app-header">
        <h1>PCB CNC</h1>
        <span className="tag">PCB machining workstation</span>
        <HeaderStatus />
      </header>
      <DockShell />
    </div>
  );
}
