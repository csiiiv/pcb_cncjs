// Serial console: raw serialport:read lines.
import { useEffect, useRef, useState } from 'react';
import { useMachineState } from '../cnc/runtime.js';

export default function ConsoleWidget() {
  const snap = useMachineState();
  const ref = useRef(null);
  const [autoscroll, setAutoscroll] = useState(true);

  useEffect(() => {
    if (autoscroll && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [snap.consoleLines, autoscroll]);

  return (
    <section className="widget console-widget">
      <div className="widget-head">
        <h2>Console</h2>
        <span className="spacer" />
        <label className="hint">
          <input type="checkbox" checked={autoscroll} onChange={(e) => setAutoscroll(e.target.checked)} />
          autoscroll
        </label>
      </div>
      <div className="console" ref={ref}>
        {snap.consoleLines.length === 0 && <div className="hint">no serial traffic yet</div>}
        {snap.consoleLines.map((entry, i) =>
          typeof entry === 'string' ? (
            // legacy string entries (pre-direction format)
            <div key={i} className="console-line">{entry}</div>
          ) : (
            <div key={i} className={`console-line dir-${entry.dir}`}>
              <span className="dir-tag">{entry.dir === 'out' ? '>' : '<'}</span>
              {entry.text}
            </div>
          )
        )}
      </div>
    </section>
  );
}
