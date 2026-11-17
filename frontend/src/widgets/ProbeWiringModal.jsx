// Probe wiring confirmation modal — the gate every probing move passes
// through (probe/wiring.js). Live circuit lamp: GRBL reports the probe pin
// in every status report (Pn:P); touching plate to tool must light it.
// A mis-wired probe on G38.2 = full-travel plunge at probe feed.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStoreSelector } from '../cnc/runtime.js';
import { useWiringCheck, confirmWiringStart, cancelWiringStart, setWiringConfirmEnabled } from '../probe/wiring.js';
import { getDefaults } from '../settings/store.js';
import { useModalStack, isTopModal } from '../ui/ModalKit.jsx';

const WIRING_MODAL_ID = 'probe-wiring';

const KIND_LABEL = { touch: 'Single-axis touch probe', map: 'Surface probe (autolevel)', test: 'Repeatability test' };
const KIND_MOTION = {
  touch: 'the tool moves along one axis until it touches the plate',
  map: 'the tool visits every lattice point, tapping the surface at each',
  test: 'the tool taps each chosen spot repeatedly'
};

export default function ProbeWiringModal() {
  const check = useWiringCheck();
  const open = Boolean(check);
  useModalStack(open, WIRING_MODAL_ID);
  const pinState = useStoreSelector((s) => s.pinState);
  const portOpen = useStoreSelector((s) => Boolean(s.connectedPort));
  const [confirmEnabled, setConfirmEnabled] = useState(() => getDefaults('probe')?.confirmWiring !== false);

  // Latch: the circuit closing at ANY point during this check verifies the
  // wiring. Requiring it lit at the exact click moment would force users to
  // hold plate against tool one-handed while clicking.
  const [everClosed, setEverClosed] = useState(false);
  useEffect(() => {
    if (open) setEverClosed(false); // fresh check per probe start
  }, [open]);
  useEffect(() => {
    if (open && (pinState || '').includes('P')) setEverClosed(true);
  }, [open, pinState]);
  const verified = everClosed;

  // refresh the checkbox from saved settings each time the check opens
  useEffect(() => {
    if (open) setConfirmEnabled(getDefaults('probe')?.confirmWiring !== false);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape' && isTopModal(WIRING_MODAL_ID)) cancelWiringStart();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!check) return null;
  const circuit = (pinState || '').includes('P');  const kind = KIND_LABEL[check.kind] ?? 'Probe move';

  return createPortal(
    <div className="modal-backdrop center probe-wiring" onMouseDown={cancelWiringStart}>
      <div
        className="modal-panel probe-wiring-panel"
        role="alertdialog"
        aria-label="Probe wiring check"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>Probe wiring check</h2>
          <span className="spacer" />
          <button onClick={cancelWiringStart} aria-label="Cancel probe">×</button>
        </div>
        <div className="modal-body">
          <p className="pw-kind">{kind}{check.detail ? ` — ${check.detail}` : ''}</p>
          <p>
            {KIND_MOTION[check.kind] || 'the tool moves until the probe circuit trips'}.
            Before starting, make sure the probe wires are properly connected:
          </p>
          <ul className="pw-checklist">
            <li>Alligator clip firmly on the <b>tool shank or collet</b> (bare metal — not paint, not the bit flute).</li>
            <li>Touch plate lead connected; plate resting flat on the PCB copper, clear of clamps and screws.</li>
            <li>Leads clear of the moving axes — the wire must never be able to snag.</li>
          </ul>

          <div className={`pw-circuit ${circuit ? 'closed' : verified ? 'latched' : 'open'}`}>
            <span className="pw-lamp" aria-hidden="true" />
            <div>
              <b>{circuit ? 'Probe circuit closed' : verified ? 'Circuit verified ✓' : 'Probe circuit open'}</b>
              <span className="hint">
                {circuit
                  ? 'Pin P is active — plate and tool are electrically connected.'
                  : verified
                    ? 'The circuit registered closed earlier in this check — wiring verified. You can let go and start.'
                    : 'Touch the plate to the tool tip now: the lamp must light once before you start.'}
              </span>
              {!portOpen && <span className="hint">No live pin state — machine port not connected.</span>}
            </div>
          </div>

          <div className="pw-warning" role="alert">
            A probe that never registers contact (broken wire, wrong pin, wrong polarity)
            will drive the tool the <b>full travel distance at probe feed into the board</b> —
            snapping the bit and gouging the workpiece. G38.2 alarms only after the miss.
          </div>
        </div>
        <div className="modal-foot">
          <label className="check-label pw-suppress">
            <input
              type="checkbox"
              checked={!confirmEnabled}
              onChange={(e) => setWiringConfirmEnabled(!e.target.checked)}
            />
            Don’t ask again (Settings → Probe)
          </label>
          <span className="spacer" />
          <button onClick={cancelWiringStart}>Cancel</button>
          <button
            className={verified ? 'primary' : ''}
            onClick={confirmWiringStart}
            title={verified ? 'Wiring verified — start probing' : 'Start anyway (circuit not verified)'}
          >
            {verified ? 'Circuit verified — probe' : 'Start anyway'}
          </button>
          {!verified && (
            <span className="pw-start-anyway hint">starting without a closed circuit is how bits break</span>
          )}
          {verified && !circuit && <span className="pw-start-anyway hint">verified earlier this check — safe to start</span>}
          {verified && circuit && <span className="pw-start-anyway hint">double-check: the lamp must be lit</span>}
        </div>
      </div>
    </div>,
    document.body
  );
}
