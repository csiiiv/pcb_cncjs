// Step-through G-code preview (job/selection via viz store).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useViz } from '../visualizer/vizStore.js';

export default function GcodePreviewWidget() {
  const v = useViz();
  const job = v.job;
  const [activeLine, setActiveLine] = useState(null);
  const [followSelection, setFollowSelection] = useState(true);
  const listRef = useRef(null);

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

  useEffect(() => {
    if (activeLine == null) return;
    const entry = lines.find((l) => l.lineNo === activeLine);
    if (entry?.segs) v.scene?.setPreviewCursor(entry.segs, entry.segs[entry.segs.length - 1].end);
    else v.scene?.setPreviewCursor(null);
    const el = listRef.current?.querySelector(`[data-line="${activeLine}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeLine, lines]);

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
        <label className="hint">
          <input type="checkbox" checked={followSelection} onChange={(e) => setFollowSelection(e.target.checked)} />
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
