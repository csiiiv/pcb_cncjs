import { useMachineState, stateColor } from './cnc/runtime.js';
import DockShell from './DockShell.jsx';
import './app.css';

export default function App() {
  const snap = useMachineState();

  return (
    <div className="app">
      <header className="app-header">
        <h1>PCB CNC</h1>
        <span className="tag">PCB machining workstation</span>
        <span className={`tag ${stateColor(snap.activeState)}`}>
          {snap.connectedPort ? snap.activeState ?? '—' : 'port closed'}
        </span>
      </header>
      <DockShell />
    </div>
  );
}
