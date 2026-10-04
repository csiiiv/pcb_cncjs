// Phase 2 machine controls: unlock/reset, jogging, work zeroing.
// Every button performs exactly one explicit machine action (click = one jog
// of the selected increment). Panel is disabled without a port connection;
// jogs are additionally blocked while GRBL is in Alarm state.
const INCREMENTS = [0.01, 0.1, 1, 10]; // mm
const JOG_FEED_XY = 500; // mm/min
const JOG_FEED_Z = 100; // mm/min — gentler on Z

export default function MachineControls({ cmds, enabled, activeState }) {
  const alarm = activeState === 'Alarm';
  const jogBlocked = !enabled || alarm;

  const jog = (axis, direction) =>
    cmds.jog({
      axis,
      direction,
      feed: axis === 'Z' ? JOG_FEED_Z : JOG_FEED_XY
      // distance comes from the selected increment in commands.jog caller
    });

  return (
    <section className="panel">
      <h2>Machine Controls</h2>

      <div className="row">
        <span className="label">GRBL</span>
        <button disabled={!enabled} onClick={() => cmds.unlock()} title="$X — clear alarm state">
          Unlock ($X)
        </button>
        <button
          disabled={!enabled}
          onClick={() => cmds.reset()}
          title="^x soft-reset — stops motion, clears state"
        >
          Reset
        </button>
      </div>

      <div className="row">
        <span className="label">Step</span>
        {INCREMENTS.map((d) => (
          <button
            key={d}
            className={`toggle ${cmds.increment === d ? 'on' : ''}`}
            disabled={!enabled}
            onClick={() => cmds.setIncrement(d)}
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
          <span className="jog-center">{cmds.increment} mm</span>
          <button disabled={jogBlocked} onClick={() => jog('X', 1)}>X+</button>
          <span />
          <button disabled={jogBlocked} onClick={() => jog('Y', -1)}>Y−</button>
          <span />
        </div>
        <div className="jog-z">
          <button disabled={jogBlocked} onClick={() => jog('Z', 1)}>Z+</button>
          <span className="jog-center">{cmds.increment} mm</span>
          <button disabled={jogBlocked} onClick={() => jog('Z', -1)}>Z−</button>
        </div>
        <button className="jog-stop" disabled={!enabled} onClick={() => cmds.jogCancel()}>
          Stop jog
        </button>
      </div>

      <div className="row">
        <span className="label">Zero (G54)</span>
        <button disabled={!enabled} onClick={() => cmds.zeroAxis('X')}>Zero X</button>
        <button disabled={!enabled} onClick={() => cmds.zeroAxis('Y')}>Zero Y</button>
        <button disabled={!enabled} onClick={() => cmds.zeroXY()}>Zero XY</button>
        <button disabled={!enabled} onClick={() => cmds.zeroAxis('Z')}>Zero Z</button>
      </div>

      {alarm && (
        <div className="error">
          GRBL is in Alarm state — jogs blocked. Inspect the machine, then Unlock.
        </div>
      )}
    </section>
  );
}
