// Serial console: raw serialport:read/write lines, ring-buffered.
import { memo, useEffect, useRef, useState } from 'react';
import { useStoreSelector, store } from '../cnc/runtime.js';

// Stable key + memo: a ring-buffer trim re-keys nothing (index keys did), and
// a row only re-renders when its own entry changes — not on every store commit.
const ConsoleRow = memo(function ConsoleRow({ entry }) {
  return (
    <div className={`console-line dir-${entry.dir}`}>
      <span className="dir-tag">{entry.dir === 'out' ? '>' : '<'}</span>
      {entry.text}
    </div>
  );
});

export default function ConsoleWidget() {
  const consoleLines = useStoreSelector((s) => s.consoleLines);
  const ref = useRef(null);
  const [autoscroll, setAutoscroll] = useState(true);

  const count = consoleLines.length;
  useEffect(() => {
    // re-stick on NEW LINES ONLY — not on unrelated store commits (DRO ticks)
    if (autoscroll && ref.current && count > 0) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [count, autoscroll]);

  return (
    <section className="widget console-widget">
      <div className="widget-head">
        <h2>Console</h2>
        <span className="spacer" />
        <label className="hint">
          <input type="checkbox" checked={autoscroll} onChange={(e) => setAutoscroll(e.target.checked)} />
          autoscroll
        </label>
        <button onClick={() => store.clearConsole()} title="clear console">Clear</button>
      </div>
      <div className="console" ref={ref}>
        {count === 0 && <div className="hint">no serial traffic yet</div>}
        {consoleLines.map((entry) => <ConsoleRow key={entry.id} entry={entry} />)}
      </div>
    </section>
  );
}
