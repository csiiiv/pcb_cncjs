// Step-through G-code preview (brief §14: inspect cutting order; §20 traceability).
// Selecting a line highlights its segment(s) in 3D and vice versa.
import { useEffect, useMemo, useRef, useState } from 'react';

export default function GcodePreviewPanel({ job, selection, onSelectSegment }) {
  const [activeLine, setActiveLine] = useState(null);
  const [followSelection, setFollowSelection] = useState(true);
  const listRef = useRef(null);

  // classify each source line once per job
  const lines = useMemo(() => {
    if (!job) return [];
    const segByLine = new Map(); // lineNo -> [{pathId, segmentId, end}]
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
      const kind = segs ? (segs[0].segmentId === undefined ? 'cut' : 'cut')
        : rapid ? 'rapid' : /^\s*(;|\(|$)/.test(text) || /^\s*(G21|G90|G17|M|T|F)/.test(text.trim()) && !segs ? 'other' : 'other';
      return { lineNo, text: text || ' ', kind: segs ? 'cut' : rapid ? 'rapid' : 'other', segs };
    });
  }, [job]);

  // segment selection (from 3D click) -> active line
  useEffect(() => {
    if (followSelection && selection && !selection.region && selection.sourceLine) {
      setActiveLine(selection.sourceLine);
    }
  }, [selection, followSelection]);

  // active line -> 3D preview cursor + scroll into view
  useEffect(() => {
    if (activeLine == null) return;
    const entry = lines.find((l) => l.lineNo === activeLine);
    if (entry?.segs) {
      onSelectSegment?.(entry.segs, entry.segs[entry.segs.length - 1].end);
    } else {
      onSelectSegment?.(null); // clear cursor on non-geometry lines
    }
    const el = listRef.current?.querySelector(`[data-line="${activeLine}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeLine, lines]);

  // keyboard: arrows step geometry-bearing lines
  useEffect(() => {
    if (!job) return undefined;
    const geoLines = lines.filter((l) => l.segs);
    const onKey = (e) => {
      if (e.key === 'Escape') { setActiveLine(null); onSelectSegment?.(null); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      if (!geoLines.length) return;
      const idx = geoLines.findIndex((l) => l.lineNo === activeLine);
      let next;
      if (idx === -1) next = geoLines[0];
      else next = geoLines[Math.min(geoLines.length - 1, Math.max(0, idx + (e.key === 'ArrowDown' ? 1 : -1)))];
      setActiveLine(next.lineNo);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [job, lines, activeLine]);

  if (!job) {
    return (
      <section className="panel gcode-panel">
        <h2>G-code</h2>
        <div className="hint">load a job to preview its G-code</div>
      </section>
    );
  }

  return (
    <section className="panel gcode-panel">
      <div className="dro-head">
        <h2>G-code</h2>
        <span className="hint">
          ↑/↓ step · click line = show in 3D{activeLine != null ? ` · line ${activeLine}` : ''}
        </span>
        <span className="spacer" />
        <label className="hint">
          <input
            type="checkbox"
            checked={followSelection}
            onChange={(e) => setFollowSelection(e.target.checked)}
          />
          follow 3D selection
        </label>
      </div>
      <div className="gcode-list" ref={listRef}>
        {lines.map((l) => (
          <div
            key={l.lineNo}
            data-line={l.lineNo}
            className={`gcode-line kind-${l.kind} ${l.lineNo === activeLine ? 'active' : ''}`}
            onClick={() => setActiveLine(l.lineNo)}
          >
            <span className="ln">{l.lineNo}</span>
            <span className="txt">{l.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
