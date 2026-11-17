import { ParameterLabel } from '../ui/InfoIcon.jsx';
import { parameterHelp } from '../ui/parameterHelp.js';
import { useDefaultState, getDefaults } from '../settings/store.js';
import { toast } from '../ui/toast.js';
// Machine controls: unlock/reset, jog cluster, zeroing, optional keyboard jog.
import { useEffect, useRef, useState } from 'react';
import { machineCommands, store } from '../cnc/runtime.js';

const INCREMENTS = [0.01, 0.1, 1, 10];

// $J= jogs are abortable with jog-cancel and don't disturb modal state — safe
// for keyboard repeat. Block whenever an input owns the caret or a modal is up
// (its arrow keys belong to its own widgets).
function targetBlocksKeys(t) {
  const tag = t?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable;
}

export default function MachineControlsWidget() {
  const snap = useMachineStateProxy();
  const [increment, setIncrement] = useDefaultState('controls', 'increment');
  const [feeds] = useState(() => getDefaults('controls'));
  const [kbEnabled, setKbEnabled] = useState(false); // opt-in keyboard jog
  const kbRef = useRef(false); // listener sees live state without re-binding
  kbRef.current = kbEnabled;
  const enabled = Boolean(snap.connectedPort);
  const alarm = snap.activeState === 'Alarm';
  const jogBlocked = !enabled || alarm;

  const jog = (axis, direction) =>
    machineCommands.jog({
      axis,
      direction,
      distance: increment,
      feed: axis === 'Z' ? feeds.feedZ : feeds.feedXY
    });

  // diagonal XY jog — both axes move the same increment (path length √2×step,
  // but each axis travels exactly `increment`, consistent with CNCjs et al.)
  const jogDiag = (dx, dy) =>
    machineCommands.jogVector(
      { X: dx * increment, Y: dy * increment },
      { feed: feeds.feedXY }
    );

  const zero = (label, fn) => () => {
    try {
      fn();
      toast(`${label} set in ${snap.modal?.wcs ?? 'G54'}`);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  // Keyboard jog: opt-in toggle, arrows = XY, PgUp/PgDn = Z. Reads live state
  // from the store (port/alarm) so the listener never goes stale.
  useEffect(() => {
    if (!kbEnabled) return undefined;
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (targetBlocksKeys(e.target)) return;
      if (document.querySelector('.modal-backdrop')) return;
      const s = store.getSnapshot();
      if (!s.connectedPort || s.activeState === 'Alarm') return;
      const map = {
        ArrowUp: () => jogDiagRef.current(0, 1),
        ArrowDown: () => jogDiagRef.current(0, -1),
        ArrowLeft: () => jogDiagRef.current(-1, 0),
        ArrowRight: () => jogDiagRef.current(1, 0),
        PageUp: () => jogRef.current('Z', 1),
        PageDown: () => jogRef.current('Z', -1)
      };
      const fn = map[e.key];
      if (!fn) return;
      e.preventDefault();
      try { fn(); } catch { /* jog channel busy — ignore */ }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [kbEnabled]);

  const jogRef = useRef(jog);
  const jogDiagRef = useRef(jogDiag);
  jogRef.current = jog;
  jogDiagRef.current = jogDiag;

  return (
    <section className="widget">
      <h2>Machine Controls</h2>
      <div className="row">
        <span className="label">GRBL</span>
        <button disabled={!enabled} onClick={() => machineCommands.unlock()}>Unlock ($X)</button>
        <button disabled={!enabled} onClick={() => machineCommands.reset()}>Reset</button>
      </div>
      <div className="row">
        <span className="label"><ParameterLabel label="Step" help={parameterHelp('controls', 'increment')} /></span>
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
          <button disabled={jogBlocked} onClick={() => jogDiag(-1, 1)} title="X− Y+">↖</button>
          <button disabled={jogBlocked} onClick={() => jog('Y', 1)}>Y+</button>
          <button disabled={jogBlocked} onClick={() => jogDiag(1, 1)} title="X+ Y+">↗</button>
          <button disabled={jogBlocked} onClick={() => jog('X', -1)}>X−</button>
          <span className="jog-center">{increment} mm</span>
          <button disabled={jogBlocked} onClick={() => jog('X', 1)}>X+</button>
          <button disabled={jogBlocked} onClick={() => jogDiag(-1, -1)} title="X− Y−">↙</button>
          <button disabled={jogBlocked} onClick={() => jog('Y', -1)}>Y−</button>
          <button disabled={jogBlocked} onClick={() => jogDiag(1, -1)} title="X+ Y−">↘</button>
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
        <span className="label">Keyboard</span>
        <button
          className={`toggle ${kbEnabled ? 'on' : ''}`}
          disabled={!enabled}
          onClick={() => setKbEnabled((v) => !v)}
          title="Arrows jog X/Y, PgUp/PgDn jog Z at the selected step. Off when a modal or text field has focus."
        >
          {kbEnabled ? 'Jog keys ON' : 'Jog keys off'}
        </button>
        {kbEnabled && <span className="hint">arrows = XY · PgUp/PgDn = Z · {increment} mm</span>}
      </div>
      <div className="row">
        <span className="label">Zero (G54)</span>
        <button disabled={!enabled} onClick={zero('X0', () => machineCommands.zeroAxis('X'))}>Zero X</button>
        <button disabled={!enabled} onClick={zero('Y0', () => machineCommands.zeroAxis('Y'))}>Zero Y</button>
        <button disabled={!enabled} onClick={zero('Z0', () => machineCommands.zeroAxis('Z'))}>Zero Z</button>
        <button disabled={!enabled} onClick={zero('X0 Y0', () => machineCommands.zeroXY())}>Zero XY</button>
        <button disabled={!enabled} onClick={zero('X0 Y0 Z0', () => machineCommands.zeroAll())}>Zero XYZ</button>
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
