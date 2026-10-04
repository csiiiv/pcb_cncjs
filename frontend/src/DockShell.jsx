// Desktop dock shell: left sidebar / center viewer / right sidebar.
// Widgets are draggable between sidebar slots and reorderable within a slot.
// Sidebars are resizable via drag gutters. Layout persists to localStorage.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ConnectionWidget, DroWidget, StatusWidget, MachineControlsWidget,
  VisualizerWidget, GcodePreviewWidget, ConsoleWidget
} from './widgets/index.js';

const WIDGETS = {
  connection: { title: 'Connection', component: ConnectionWidget },
  dro: { title: 'DRO', component: DroWidget },
  status: { title: 'Status', component: StatusWidget },
  controls: { title: 'Machine Controls', component: MachineControlsWidget },
  visualizer: { title: 'Toolpath', component: VisualizerWidget },
  gcode: { title: 'G-code', component: GcodePreviewWidget },
  console: { title: 'Console', component: ConsoleWidget }
};

const DEFAULT_LAYOUT = {
  left: ['connection', 'dro', 'status'],
  center: ['visualizer', 'gcode'],
  right: ['controls', 'console']
};

const STORAGE_KEY = 'pcb-cnc-layout-v1';

function loadLayout() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // validate: all ids must be known widgets, no duplicates across zones
    const ids = [...parsed.left, ...parsed.center, ...parsed.right];
    if (ids.length !== Object.keys(WIDGETS).length) return null;
    if (new Set(ids).size !== ids.length) return null;
    if (ids.some((id) => !WIDGETS[id])) return null;
    return parsed;
  } catch {
    return null;
  }
}

export default function DockShell() {
  const [layout, setLayout] = useState(() => loadLayout() || DEFAULT_LAYOUT);
  const [closed, setClosed] = useState([]); // widget ids removed from layout
  const [widths, setWidths] = useState(() => {
    try { return JSON.parse(localStorage.getItem('pcb-cnc-widths') || 'null') || { left: 300, right: 320 }; }
    catch { return { left: 300, right: 320 }; }
  });
  const [drag, setDrag] = useState(null); // { id, fromZone }
  const [dropTarget, setDropTarget] = useState(null); // { zone, index }

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  }, [layout]);
  useEffect(() => {
    localStorage.setItem('pcb-cnc-widths', JSON.stringify(widths));
  }, [widths]);

  const moveWidget = useCallback((id, toZone, toIndex) => {
    setLayout((prev) => {
      const zones = {
        left: [...prev.left],
        center: [...prev.center],
        right: [...prev.right]
      };
      const fromZone = Object.keys(zones).find((z) => zones[z].includes(id));
      if (!fromZone) return prev;
      zones[fromZone] = zones[fromZone].filter((w) => w !== id);
      const idx = Math.min(toIndex ?? zones[toZone].length, zones[toZone].length);
      zones[toZone].splice(idx, 0, id);
      return zones;
    });
  }, []);

  const closeWidget = (id) => {
    setLayout((prev) => ({
      left: prev.left.filter((w) => w !== id),
      center: prev.center.filter((w) => w !== id),
      right: prev.right.filter((w) => w !== id)
    }));
    setClosed((c) => [...c, id]);
  };

  const restoreWidget = (id) => {
    setLayout((prev) => ({ ...prev, right: [...prev.right, id] }));
    setClosed((c) => c.filter((x) => x !== id));
  };

  // --- resize gutters ---
  const startResize = (side) => (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = widths[side];
    const onMove = (ev) => {
      const delta = side === 'left' ? ev.clientX - startX : startX - ev.clientX;
      setWidths((w) => ({ ...w, [side]: Math.min(560, Math.max(220, startW + delta)) }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.classList.remove('resizing');
    };
    document.body.classList.add('resizing');
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const renderZone = (zone) => (
    <div
      className={`dock-zone dock-${zone} ${dropTarget?.zone === zone && dropTarget.index == null ? 'drop-hover' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDropTarget({ zone }); }}
      onDragLeave={() => setDropTarget(null)}
      onDrop={(e) => {
        e.preventDefault();
        if (drag) moveWidget(drag.id, zone, dropTarget?.index ?? null);
        setDrag(null);
        setDropTarget(null);
      }}
    >
      {layout[zone].map((id, i) => {
        const W = WIDGETS[id];
        const isDropBefore = dropTarget?.zone === zone && dropTarget.index === i && drag;
        return (
          <div key={id}>
            {isDropBefore && <div className="drop-indicator" />}
            <div
              className={`widget-slot ${drag?.id === id ? 'dragging' : ''}`}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDropTarget({ zone, index: i }); }}
            >
              <div
                className="widget-drag-handle"
                draggable
                onDragStart={(e) => { setDrag({ id, fromZone: zone }); e.dataTransfer.effectAllowed = 'move'; }}
                onDragEnd={() => { setDrag(null); setDropTarget(null); }}
                title="drag to rearrange"
              >
                <span className="grip">⠿</span>
                <span className="widget-title">{W.title}</span>
                <button className="widget-close" onClick={() => closeWidget(id)} title="close widget">×</button>
              </div>
              <div className="widget-body">
                <W.component />
              </div>
            </div>
          </div>
        );
      })}
      {dropTarget?.zone === zone && dropTarget.index === layout[zone].length && drag && (
        <div className="drop-indicator" />
      )}
      {layout[zone].length === 0 && <div className="dock-empty">drop widgets here</div>}
    </div>
  );

  return (
    <div className="dock-shell">
      <aside className="dock-sidebar dock-left" style={{ width: widths.left }}>
        {renderZone('left')}
      </aside>
      <div className="dock-gutter" onMouseDown={startResize('left')} />
      <main className="dock-center">{renderZone('center')}</main>
      <div className="dock-gutter" onMouseDown={startResize('right')} />
      <aside className="dock-sidebar dock-right" style={{ width: widths.right }}>
        {renderZone('right')}
      </aside>
      {closed.length > 0 && (
        <div className="restore-bar">
          {closed.map((id) => (
            <button key={id} onClick={() => restoreWidget(id)}>+ {WIDGETS[id].title}</button>
          ))}
        </div>
      )}
      {drag && <div className="drag-ghost">{WIDGETS[drag.id].title}</div>}
    </div>
  );
}
