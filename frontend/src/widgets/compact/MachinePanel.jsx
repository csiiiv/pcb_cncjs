// Compact machine column: Connection + Status + DRO + Controls + Spindle in
// one dense panel (ui-modes.md §4). Thin composition over the same stores
// and commands the standalone widgets use — no re-implemented commands.
import { useEffect, useRef, useState } from 'react';
import { machineCommands, connection, store, useMachineState, fmtAxis } from '../../cnc/runtime.js';
import { getDefaults } from '../../settings/store.js';
import { connectMachine } from '../../cnc/autoConnect.js';
import { ConnectionState } from '../../cnc/connection.js';
import { canControlSpindle, reportedSpindleMode } from '../../cnc/spindle.js';
import { toast } from '../../ui/toast.js';

const INCREMENTS = [0.01, 0.1, 1, 10];
const USB_RE = /^\/dev\/tty(USB|ACM)/;

function blocksKeys(t) {
  const tag = t?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable;
}

function Section({ title, summary, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mp-section">
      <button className="mp-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={`mp-caret ${open ? 'open' : ''}`}>▸</span>
        <span className="mp-title">{title}</span>
        {!open && summary && <span className="mp-summary">{summary}</span>}
      </button>
      {open && <div className="mp-body">{children}</div>}
    </div>
  );
}

export default function MachinePanel({ lite = false }) {
  const snap = useMachineState();
  const [increment, setIncrement] = useState(() => getDefaults('controls').increment);
  const [feeds] = useState(() => getDefaults('controls'));
  const [rpmText, setRpmText] = useState(() => String(getDefaults('spindle').rpm));
  const [kbJog, setKbJog] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connError, setConnError] = useState(null);
  const defaults = useRef(getDefaults('connection')).current;

  const enabled = Boolean(snap.connectedPort);
  const alarm = snap.activeState === 'Alarm';
  const jogBlocked = !enabled || alarm;
  const spindleOk = enabled && canControlSpindle(snap);
  const rpm = Number(rpmText);
  const rpmValid = rpmText.trim() !== '' && Number.isSafeInteger(rpm) && rpm >= 0;

  const jog = (axis, dir) => machineCommands.jog({ axis, direction: dir, distance: increment, feed: axis === 'Z' ? feeds.feedZ : feeds.feedXY });
  const jogDiag = (dx, dy) => machineCommands.jogVector({ X: dx * increment, Y: dy * increment }, { feed: feeds.feedXY });

  // Opt-in keyboard jog — identical guards to MachineControlsWidget.
  const handlers = useRef({});
  handlers.current = { jog, jogDiag };
  useEffect(() => {
    if (!kbJog) return undefined;
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (blocksKeys(e.target)) return;
      if (document.querySelector('.modal-backdrop')) return;
      const s = store.getSnapshot();
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
      try { fn(); } catch { /* channel busy */ }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [kbJog]);

  const connectAll = async () => {
    try {
      setConnecting(true); setConnError(null);
      const port = await connectMachine(connection, defaults, 5000);
      toast(`Machine connected on ${port}`);
    } catch (err) {
      setConnError(err.message);
    } finally {
      setConnecting(false);
    }
  };

  const zero = (label, fn) => () => {
    try { fn(); toast(`${label} set in ${snap.modal?.wcs ?? 'G54'}`); }
    catch (err) { toast(err.message, 'error'); }
  };

  const mode = reportedSpindleMode(snap);
  const units = snap.modal?.units === 'G21' ? 'mm' : snap.modal?.units === 'G20' ? 'in' : '';

  return (
    <div className={`machine-panel ${lite ? 'lite' : ''}`}>
      {/* connection strip */}
      <div className="mp-conn">
        <span className={`footer-pill state-${snap.server === ConnectionState.CONNECTED ? (enabled ? 'idle' : 'offline') : 'offline'}`}>
          {snap.activeState ?? 'offline'}
        </span>
        <span className="mp-conn-info">
          {enabled
            ? <><span className="ok-text">{snap.connectedPort}</span>{snap.firmware ? <span className="hint"> · {snap.firmware}</span> : null}</>
            : <span className="hint">{snap.server === ConnectionState.CONNECTED ? 'server on · port closed' : 'disconnected'}</span>}
        </span>
        {!enabled && (
          <button className="mp-connect" disabled={connecting} onClick={connectAll}>
            {connecting ? '…' : 'Connect'}
          </button>
        )}
        {enabled && (
          <button className="mp-connect" disabled={connecting} onClick={async () => {
            try { await connection.closePort(snap.connectedPort); } catch (err) { setConnError(err.message); }
          }}>Close</button>
        )}
      </div>
      {connError && <div className="error">{connError}</div>}

      {/* DRO */}
      <div className="mp-dro">
        {['x', 'y', 'z'].map((a) => (
          <div key={a} className="mp-axis">
            <span className="axis-name">{a.toUpperCase()}</span>
            <span className="axis-value">{fmtAxis(snap.wpos?.[a], 2)}</span>
          </div>
        ))}
        <span className="mp-units">{units}</span>
      </div>

      {alarm && <div className="mp-alarm">Alarm — unlock required</div>}

      {/* jog + zero */}
      <div className="mp-grid">
        <div className="jog-grid">
          <button disabled={jogBlocked} onClick={() => jogDiag(-1, 1)} title="X− Y+">↖</button>
          <button disabled={jogBlocked} onClick={() => jog('Y', 1)}>Y+</button>
          <button disabled={jogBlocked} onClick={() => jogDiag(1, 1)} title="X+ Y+">↗</button>
          <button disabled={jogBlocked} onClick={() => jog('X', -1)}>X−</button>
          <span className="jog-center">{increment}</span>
          <button disabled={jogBlocked} onClick={() => jog('X', 1)}>X+</button>
          <button disabled={jogBlocked} onClick={() => jogDiag(-1, -1)} title="X− Y−">↙</button>
          <button disabled={jogBlocked} onClick={() => jog('Y', -1)}>Y−</button>
          <button disabled={jogBlocked} onClick={() => jogDiag(1, -1)} title="X+ Y−">↘</button>
        </div>
        <div className="mp-side">
          <div className="mp-steps">
            {INCREMENTS.map((d) => (
              <button key={d} className={`toggle ${increment === d ? 'on' : ''}`} disabled={!enabled}
                onClick={() => setIncrement(d)}>{d}</button>
            ))}
          </div>
          <button className="jog-stop" disabled={!enabled} onClick={() => machineCommands.jogCancel()}>Stop jog</button>
          <button className={`toggle ${kbJog ? 'on' : ''}`} disabled={!enabled}
            onClick={() => setKbJog((v) => !v)}
            title="Arrows jog X/Y, PgUp/PgDn jog Z. Off in text fields and modals.">
            {kbJog ? '⌨ on' : '⌨ off'}
          </button>
        </div>
      </div>

      <div className="mp-zero">
        <span className="hint">zero</span>
        <button disabled={!enabled} onClick={zero('X0', () => machineCommands.zeroAxis('X'))}>X</button>
        <button disabled={!enabled} onClick={zero('Y0', () => machineCommands.zeroAxis('Y'))}>Y</button>
        <button disabled={!enabled} onClick={zero('Z0', () => machineCommands.zeroAxis('Z'))}>Z</button>
        <button disabled={!enabled} onClick={zero('X0 Y0', () => machineCommands.zeroXY())}>XY</button>
        <button disabled={!enabled} onClick={zero('X0 Y0 Z0', () => machineCommands.zeroAll())}>XYZ</button>
        <span className="spacer" />
        <button disabled={!enabled} onClick={() => machineCommands.unlock()} title="Unlock ($X)">🔓</button>
        <button disabled={!enabled} onClick={() => machineCommands.reset()} title="Soft reset">⟳</button>
      </div>

      {!lite && (
        <Section title="Spindle" summary={`S${snap.spindleRpm ?? snap.spindle ?? '—'} · ${mode === 'M3' || mode === 'M4' ? 'on' : 'off'}`}>
          <div className="seg">
            <button className={`toggle ${mode === 'M3' ? 'on' : ''}`} disabled={!spindleOk || !rpmValid}
              onClick={() => machineCommands.spindleStart('M3', rpm)}>↻ CW</button>
            <button className={`toggle ${mode === 'M4' ? 'on' : ''}`} disabled={!spindleOk || !rpmValid}
              onClick={() => machineCommands.spindleStart('M4', rpm)}>↺ CCW</button>
            <button disabled={!spindleOk} onClick={() => machineCommands.spindleStop()}>Stop</button>
          </div>
          <div className="spindle-speed">
            <input type="number" min="0" step="1" value={rpmText} aria-label="Spindle RPM"
              aria-invalid={!rpmValid} onChange={(e) => setRpmText(e.target.value)} />
            <button disabled={!spindleOk || !rpmValid} onClick={() => machineCommands.spindleSpeed(rpm)}>S</button>
          </div>
          <div className="hint">reported {snap.spindleRpm ?? '—'} · programmed {snap.spindle ?? '—'}</div>
        </Section>
      )}

      {!lite && (
        <Section title="Overrides" summary={`F${snap.ov?.[0] ?? 100} R${snap.ov?.[1] ?? 100} S${snap.ov?.[2] ?? 100}`} defaultOpen={false}>
          <div className="mp-ov">
            <label>Feed</label>
            <button onClick={() => machineCommands.feedOverride(10)}>+10</button>
            <button onClick={() => machineCommands.feedOverride(1)}>+1</button>
            <button onClick={() => machineCommands.feedOverride(0)}>100</button>
            <button onClick={() => machineCommands.feedOverride(-1)}>−1</button>
            <button onClick={() => machineCommands.feedOverride(-10)}>−10</button>
          </div>
          <div className="mp-ov">
            <label>Rapid</label>
            <button onClick={() => machineCommands.rapidOverride(100)}>100</button>
            <button onClick={() => machineCommands.rapidOverride(50)}>50</button>
            <button onClick={() => machineCommands.rapidOverride(25)}>25</button>
          </div>
          <div className="mp-ov">
            <label>Spindle</label>
            <button onClick={() => machineCommands.spindleOverride(10)}>+10</button>
            <button onClick={() => machineCommands.spindleOverride(1)}>+1</button>
            <button onClick={() => machineCommands.spindleOverride(0)}>100</button>
            <button onClick={() => machineCommands.spindleOverride(-1)}>−1</button>
            <button onClick={() => machineCommands.spindleOverride(-10)}>−10</button>
          </div>
        </Section>
      )}
    </div>
  );
}
