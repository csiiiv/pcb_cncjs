// Guided step 4 — mount board + zero XY. Purpose-built jog cluster +
// Zero-XY action; completion reconciled from the G10 L20 write on the wire.
// Z jog included deliberately: clear obstacles, lift a too-low tool, etc.
import { useEffect, useRef, useState } from 'react';
import { machineCommands, useMachineState, store as machineStore } from '../../cnc/runtime.js';
import { getDefaults } from '../../settings/store.js';
import { toast } from '../../ui/toast.js';

const INCREMENTS = [0.01, 0.1, 1, 10];

function blocksKeys(t) {
  const tag = t?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable;
}

const fmt = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toFixed(2));

export default function StepZeroXY({ done }) {
  const snap = useMachineState();
  const [increment, setIncrement] = useState(() => getDefaults('controls').increment);
  const feeds = useRef(getDefaults('controls')).current;
  const [kb, setKb] = useState(false);

  const enabled = Boolean(snap.connectedPort);
  const alarm = snap.activeState === 'Alarm';
  const jogBlocked = !enabled || alarm;
  const kbBlocked = jogBlocked || snap.activeState === 'Hold' || snap.activeState === 'Run';

  const jog = (axis, dir) => machineCommands.jog({ axis, direction: dir, distance: increment, feed: axis === 'Z' ? feeds.feedZ : feeds.feedXY });
  const jogDiag = (dx, dy) => machineCommands.jogVector({ X: dx * increment, Y: dy * increment }, { feed: feeds.feedXY });

  // Opt-in arrow-key jogging while this step shows. Unlike the dock widgets
  // (which disable keys whenever any modal is open), this step IS the modal —
  // so keys stay live while no *other* modal overlays the wizard and focus
  // isn't in a text field.
  const handlers = useRef({});
  handlers.current = { jog, jogDiag };
  useEffect(() => {
    if (!kb) return undefined;
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (blocksKeys(e.target)) return;
      // any modal above the wizard (wiring check, guide, …) keeps keys off
      if (document.querySelector('.probe-wiring, .step-guide, .alarm-interstitial')) return;
      const s = machineStore.getSnapshot();
      if (!s.connectedPort || s.activeState === 'Alarm') return;
      const map = {
        ArrowUp: () => handlers.current.jogDiag(0, 1),
        ArrowDown: () => handlers.current.jogDiag(0, -1),
        ArrowLeft: () => handlers.current.jogDiag(-1, 0),
        ArrowRight: () => handlers.current.jogDiag(1, 0),
        PageUp: () => handlers.current.jog('Z', 1),
        PageDown: () => handlers.current.jog('Z', -1)
      };
      const fn = map[e.key];
      if (!fn) return;
      e.preventDefault();
      try { fn(); } catch { /* jog channel busy */ }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [kb]);

  const zeroXY = () => {
    try {
      machineCommands.zeroXY();
      toast('X0 Y0 set in G54 — board origin stored');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className="gw-step">
      <p className="gw-status">
        <span className="tag">X{fmt(snap.wpos?.x)} Y{fmt(snap.wpos?.y)} · Z{fmt(snap.wpos?.z)}</span>
        <span className={`tag ${alarm ? 'alarm' : ''}`}>{snap.activeState ?? 'offline'}</span>
        {snap.modal?.wcs && <span className="tag">{snap.modal.wcs}</span>}
      </p>

      <ol className="guide-steps">
        <li>Fix the blank copper-clad to the bed (tape or screws in waste areas).</li>
        <li>Jog the tool tip over the board's lower-left corner — or wherever your CAM origin is.</li>
        <li>Press <b>Zero XY</b> — G54 records this spot as X0 Y0.</li>
      </ol>

      {/* controls card: XY grid + Z column side by side, step + keys above */}
      <div className="gw-jogcard">
        <div className="gw-jogcard-top">
          <span className="label">Step</span>
          <div className="seg">
            {INCREMENTS.map((d) => (
              <button key={d} className={increment === d ? 'on' : ''} onClick={() => setIncrement(d)}>{d} mm</button>
            ))}
          </div>
          <span className="spacer" />
          <button
            className={`toggle ${kb ? 'on' : ''}`}
            disabled={!enabled}
            onClick={() => setKb((v) => !v)}
            title="arrow keys = XY · PgUp/PgDn = Z at the selected step. Keys work while this step is shown; text fields and other modals still block them."
          >{kb ? '⌨ keys ON' : '⌨ keys'}</button>
        </div>
        <div className="gw-jogcluster">
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
            <span className="jog-z-label">Z</span>
            <button disabled={jogBlocked} onClick={() => jog('Z', 1)}>Z+</button>
            <span className="jog-center">{increment} mm</span>
            <button disabled={jogBlocked} onClick={() => jog('Z', -1)}>Z−</button>
          </div>
          <button className="jog-stop" disabled={!enabled} onClick={() => machineCommands.jogCancel()}>
            Stop jog
          </button>
        </div>
        {kb && !kbBlocked && <p className="hint">arrows = XY · PgUp/PgDn = Z · step {increment} mm</p>}
      </div>

      <div className="gw-actions">
        <button className="primary" disabled={!enabled || alarm} onClick={zeroXY}>Zero XY (G54)</button>
        <button disabled={!enabled} onClick={() => machineCommands.unlock()} title="$X">Unlock</button>
        <span className="hint">Z stays for the touch-probe step next.</span>
      </div>
      {!enabled && <p className="hint">machine port not connected</p>}
      {alarm && <p className="hint">GRBL in Alarm — unlock before jogging</p>}
      {done && <p className="hint">Board origin set. Re-zero if the board moves.</p>}
    </div>
  );
}
