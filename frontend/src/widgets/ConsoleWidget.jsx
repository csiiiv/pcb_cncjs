import { ParameterLabel } from '../ui/InfoIcon.jsx';
import { parameterHelp } from '../ui/parameterHelp.js';
import { useDefaultState } from '../settings/store.js';
// Serial console: raw serialport:read/write lines, ring-buffered, with a
// GRBL status-report noise filter and a raw command input with history.
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { machineCommands, useStoreSelector, store } from '../cnc/runtime.js';

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

// GRBL poll-rate status reports flood the buffer and bury real responses.
const STATUS_RE = /^<(?:Idle|Run|Hold|Jog|Alarm|Door|Check|Home|Sleep)[0-9]*[:|>]/;

export default function ConsoleWidget() {
  const consoleLines = useStoreSelector((s) => s.consoleLines);
  const port = useStoreSelector((s) => s.connectedPort);
  const ref = useRef(null);
  const [autoscroll, setAutoscroll] = useDefaultState('console', 'autoscroll');
  const [hideStatus, setHideStatus] = useDefaultState('console', 'hideStatus');
  const [command, setCommand] = useState('');
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  const filtered = useMemo(
    () => (hideStatus ? consoleLines.filter((e) => !(e.dir === 'in' && STATUS_RE.test(e.text))) : consoleLines),
    [consoleLines, hideStatus]
  );
  const hiddenCount = consoleLines.length - filtered.length;

  const count = filtered.length;
  useEffect(() => {
    // re-stick on NEW LINES ONLY — not on unrelated store commits (DRO ticks)
    if (autoscroll && ref.current && count > 0) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [count, autoscroll]);

  const send = () => {
    const line = command.trim();
    if (!line) return;
    try {
      machineCommands.write(line);
      setHistory((h) => [...h.slice(-49), line]);
      setHistoryIndex(-1);
      setCommand('');
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const onCommandKey = (e) => {
    if (e.key === 'Enter') { send(); return; }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    // Local caret-vs-history: only step history when the caret is at the
    // respective end, so editing mid-string still works.
    const atStart = e.target.selectionStart === 0 && e.target.selectionEnd === 0;
    const atEnd = e.target.selectionStart === e.target.value.length && e.target.selectionEnd === e.target.value.length;
    if (e.key === 'ArrowUp' && atEnd && history.length) {
      e.preventDefault();
      const next = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(next);
      setCommand(history[next]);
    } else if (e.key === 'ArrowDown' && atStart && historyIndex !== -1) {
      e.preventDefault();
      const next = historyIndex + 1;
      if (next >= history.length) { setHistoryIndex(-1); setCommand(''); }
      else { setHistoryIndex(next); setCommand(history[next]); }
    }
  };

  return (
    <section className="widget console-widget">
      <div className="widget-head">
        <h2>Console</h2>
        <span className="spacer" />
        <label className="hint">
          <input type="checkbox" checked={hideStatus} onChange={(e) => setHideStatus(e.target.checked)} />
          <ParameterLabel label="hide status" help={parameterHelp('console', 'hideStatus')} />
        </label>
        <label className="hint">
          <input type="checkbox" checked={autoscroll} onChange={(e) => setAutoscroll(e.target.checked)} />
          <ParameterLabel label="autoscroll" help={parameterHelp('console', 'autoscroll')} />
        </label>
        <button onClick={() => store.clearConsole()} title="clear console">Clear</button>
      </div>
      <div className="console" ref={ref}>
        {count === 0 && <div className="hint">{consoleLines.length ? `${hiddenCount} status lines hidden` : 'no serial traffic yet'}</div>}
        {filtered.map((entry) => <ConsoleRow key={entry.id} entry={entry} />)}
      </div>
      <div className="console-input-row">
        <input
          ref={inputRef}
          className="console-input"
          type="text"
          value={command}
          placeholder={port ? 'send a line to the controller ($, G, M…)' : 'open a machine port to send commands'}
          disabled={!port}
          onChange={(e) => { setCommand(e.target.value); setHistoryIndex(-1); }}
          onKeyDown={onCommandKey}
          aria-label="Send command to controller"
        />
        <button disabled={!port || !command.trim()} onClick={send}>Send</button>
      </div>
      {error && <div className="error">{error}</div>}
    </section>
  );
}
