// Machine controls: unlock/reset, jog cluster, zeroing.
import { useState } from 'react';
import { machineCommands } from '../cnc/runtime.js';

const INCREMENTS = [0.01, 0.1, 1, 10];
const JOG_FEED_XY = 500;
const JOG_FEED_Z = 100;

export default function MachineControlsWidget() {
  const snap = useMachineStateProxy();
  const [increment, setIncrement] = useState(1);
  const enabled = Boolean(snap.connectedPort);
  const alarm = snap.activeState === 'Alarm';
  const jogBlocked = !enabled || alarm;

  const jog = (axis, direction) =>
    machineCommands.jog({
      axis,
      direction,
      distance: increment,
      feed: axis === 'Z' ? JOG_FEED_Z : JOG_FEED_XY
    });

  return (
    <section className="widget">
      <h2>Machine Controls</h2>
      <div className="row">
        <span className="label">GRBL</span>
        <button disabled={!enabled} onClick={() => machineCommands.unlock()}>Unlock ($X)</button>
        <button disabled={!enabled} onClick={() => machineCommands.reset()}>Reset</button>
      </div>
      <div className="row">
        <span className="label">Step</span>
        {INCREMENTS.map((d) => (
          <button
            key={d}
            className={`toggle ${increment === d ? 'on' : ''}`}
            disabled={!enabled}
            onClick={() => setIncrement(d)}
          >
            {d} mm
          </button>
        ))}
      </div>
      <div className="jog-cluster">
        <div className="jog-grid">
          <span />
          <button disabled={jogBlocked} onClick={() => jog('Y', 1)}>Y+</button>
          <span />
          <button disabled={jogBlocked} onClick={() => jog('X', -1)}>X−</button>
          <span className="jog-center">{increment} mm</span>
          <button disabled={jogBlocked} onClick={() => jog('X', 1)}>X+</button>
          <span />
          <button disabled={jogBlocked} onClick={() => jog('Y', -1)}>Y−</button>
          <span />
        </div>
        <div className="jog-z">
          <button disabled={jogBlocked} onClick={() => jog('Z', 1)}>Z+</button>
          <span className="jog-center">{increment} mm</span>
          <button disabled={jogBlocked} onClick={() => jog('Z', -1)}>Z−</button>
        </div>
        <button className="jog-stop" disabled={!enabled} onClick={() => machineCommands.jogCancel()}>
          Stop jog
        </button>
      </div>
      <div className="row">
        <span className="label">Zero (G54)</span>
        <button disabled={!enabled} onClick={() => machineCommands.zeroAxis('X')}>Zero X</button>
        <button disabled={!enabled} onClick={() => machineCommands.zeroAxis('Y')}>Zero Y</button>
        <button disabled={!enabled} onClick={() => machineCommands.zeroAxis('Z')}>Zero Z</button>
        <button disabled={!enabled} onClick={() => machineCommands.zeroXY()}>Zero XY</button>
        <button disabled={!enabled} onClick={() => machineCommands.zeroAll()}>Zero XYZ</button>
      </div>
      {alarm && (
        <div className="error">GRBL in Alarm state — jogs blocked. Inspect machine, then Unlock.</div>
      )}
    </section>
  );
}

// local hook (avoids circular import layout churn)
import { useMachineState } from '../cnc/runtime.js';
function useMachineStateProxy() {
  return useMachineState();
}
