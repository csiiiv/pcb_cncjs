// Step-through G-code preview (job/selection via viz store).
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useViz } from '../visualizer/vizStore.js';
import { useStoreSelector } from '../cnc/runtime.js';

// Memoized row: a run updates only the 1–2 rows whose active/in-buffer flags
// changed — the other N−2 rows skip re-render entirely (props are primitives).
const GcodeRow = memo(function GcodeRow({ lineNo, text, kind, active, inBuffer }) {
  return (
    <div
      data-line={lineNo}
      className={`gcode-line kind-${kind} ${active ? 'active' : ''} ${inBuffer ? 'in-buffer' : ''}`}
    >
      <span className="ln">{lineNo}</span>
      <span className="txt">{text}</span>
    </div>
  );
});

export default function GcodePreviewWidget() {
  const v = useViz();
  const execLine = useStoreSelector((s) => s.execLine);
  const sentLine = useStoreSelector((s) => s.sender?.sent ?? 0);
  const workflowState = useStoreSelector((s) => s.workflowState);
  const job = v.job;
  const [activeLine, setActiveLine] = useState(null);
  const [followSelection, setFollowSelection] = useState(true);
  const [followRun, setFollowRun] = useState(true);
  const listRef = useRef(null);

  const onListClick = useCallback((e) => {
    const row = e.target.closest('[data-line]');
    if (row) setActiveLine(Number(row.dataset.line));
  }, []);

  const lines = useMemo(() => {
    if (!job) return [];
    const segByLine = new Map();
    for (const p of job.paths) {
      for (const s of p.segments) {
        if (!segByLine.has(s.sourceLine)) segByLine.set(s.sourceLine, []);
        segByLine.get(s.sourceLine).push({ pathId: p.id, segmentId: s.id, end: s.end });
      }
    }
    const rapidByLine = new Map();
    for (const r of job.rapidMoves) rapidByLine.set(r.sourceLine, r);
    return job.text.split(/\r?\n/).map((text, i) => {
      const lineNo = i + 1;
      const segs = segByLine.get(lineNo);
      const rapid = rapidByLine.get(lineNo);
      return { lineNo, text: text || ' ', kind: segs ? 'cut' : rapid ? 'rapid' : 'other', segs };
    });
  }, [job]);

  useEffect(() => {
    if (followSelection && v.selection && !v.selection.region && v.selection.sourceLine) {
      setActiveLine(v.selection.sourceLine);
    }
  }, [v.selection, followSelection]);

  // live run tracking: GRBL-acked line preferred over sender.sent (buffered ahead)
  const workflowRunning = workflowState === 'running' || workflowState === 'paused';
  useEffect(() => {
    if (!followRun || !workflowRunning || !job) return;
    const trackLine = execLine ?? sentLine;
    if (!trackLine || !lines[trackLine - 1]) return;
    setActiveLine(trackLine);
  }, [execLine, sentLine, workflowRunning, followRun, job, lines]);

  useEffect(() => {
    if (activeLine == null) return;
    const entry = lines.find((l) => l.lineNo === activeLine);
    if (entry?.segs) v.scene?.setPreviewCursor(entry.segs, entry.segs[entry.segs.length - 1].end);
    else v.scene?.setPreviewCursor(null);
    // Scroll only this list. scrollIntoView also scrolls every ancestor and
    // forces a layout of the page; offsetTop is one row.
    const list = listRef.current;
    const row = list?.querySelector(`[data-line="${activeLine}"]`);
    if (list && row && followRun && workflowRunning) {
      const top = row.offsetTop;
      const bottom = top + row.offsetHeight;
      const viewTop = list.scrollTop;
      const viewBottom = viewTop + list.clientHeight;
      if (top < viewTop || bottom > viewBottom) {
        list.scrollTop = top - list.clientHeight / 2 + row.offsetHeight / 2;
      }
    }
  }, [activeLine, lines, followRun, workflowRunning]);

  useEffect(() => {
    if (!job) return undefined;
    const geoLines = lines.filter((l) => l.segs);
    const onKey = (e) => {
      if (e.key === 'Escape') { setActiveLine(null); v.scene?.setPreviewCursor(null); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      if (!geoLines.length) return;
      const idx = geoLines.findIndex((l) => l.lineNo === activeLine);
      const next = idx === -1
        ? geoLines[0]
        : geoLines[Math.min(geoLines.length - 1, Math.max(0, idx + (e.key === 'ArrowDown' ? 1 : -1)))];
      setActiveLine(next.lineNo);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [job, lines, activeLine]);

  if (!job) {
    return (
      <section className="widget gcode-widget">
        <h2>G-code</h2>
        <div className="hint">load a job to preview its G-code</div>
      </section>
    );
  }

  return (
    <section className="widget gcode-widget">
      <div className="widget-head">
        <h2>G-code</h2>
        <span className="hint">
          ↑/↓ step · click line = show in 3D{activeLine != null ? ` · line ${activeLine}` : ''}
        </span>
        <span className="spacer" />
        {workflowRunning && (
          <span className="hint legend">
            <span className="lg lg-exec">■</span> executing
            <span className="lg lg-buf">■</span> in buffer
          </span>
        )}
        <label className="hint">
          <input type="checkbox" checked={followRun} onChange={(e) => setFollowRun(e.target.checked)} />
          follow run
        </label>
        <label className="hint">
          <input type="checkbox" checked={followSelection} onChange={(e) => setFollowSelection(e.target.checked)} />
          follow 3D selection
        </label>
      </div>
      <div className="gcode-list" ref={listRef} onClick={onListClick}>
        {lines.map((l) => {
          const inBuffer =
            workflowRunning && execLine != null && sentLine > execLine &&
            l.lineNo > execLine && l.lineNo <= sentLine;
          return (
            <GcodeRow
              key={l.lineNo}
              lineNo={l.lineNo}
              text={l.text}
              kind={l.kind}
              active={l.lineNo === activeLine}
              inBuffer={inBuffer}
            />
          );
        })}
      </div>
    </section>
  );
}
