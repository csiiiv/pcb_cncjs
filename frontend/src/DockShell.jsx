// Desktop dock shell: left sidebar / center viewer / right sidebar.
// Widgets are draggable between sidebar slots and reorderable within a slot.
// Sidebars are resizable via drag gutters. Layout persists to localStorage.
import { onShowToolpath } from './visualizer/vizStore.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ConnectionWidget, DroWidget, StatusWidget, MachineControlsWidget, SpindleWidget, CamWidget, ToolTestWidget,
  VisualizerWidget, GcodePreviewWidget, ConsoleWidget, JobRunnerWidget, ProbeWidget, AutolevelWidget
} from './widgets/index.js';
import MachinePanelWidget from './widgets/compact/MachinePanel.jsx';

const WIDGETS = {
  connection: { title: 'Connection', component: ConnectionWidget },
  dro: { title: 'DRO', component: DroWidget },
  status: { title: 'Status', component: StatusWidget },
  controls: { title: 'Machine Controls', component: MachineControlsWidget },
  spindle: { title: 'Spindle', component: SpindleWidget },
  machine: { title: 'Machine (compact)', component: MachinePanelWidget },
  cam: { title: 'PCB CAM', component: CamWidget },
  tooltest: { title: 'Tool Test', component: ToolTestWidget },
  visualizer: { title: 'Toolpath', component: VisualizerWidget, grow: true, flex: true },
  gcode: { title: 'G-code', component: GcodePreviewWidget, grow: true, flex: true, defaultHeight: 300 },
  runner: { title: 'Job Runner', component: JobRunnerWidget },
  probe: { title: 'Probe', component: ProbeWidget },
  autolevel: { title: 'Autolevel', component: AutolevelWidget },
  console: { title: 'Console', component: ConsoleWidget, grow: true, flex: true, defaultHeight: 260 }
};

const DEFAULT_LAYOUT = {
  left: ['connection', 'cam', 'tooltest', 'dro', 'status'],
  center: ['visualizer', 'gcode'],
  right: ['controls', 'spindle', 'probe', 'autolevel', 'runner', 'console']
};

// Compact preset (ui-modes.md §8): these five swap for the single 'machine'
// composite; the originals stay registered and restorable.
const MACHINE_FIVE = ['connection', 'dro', 'status', 'controls', 'spindle'];

const STORAGE_KEY = 'pcb-cnc-layout-v1';

function loadLayout() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // validate: all ids must be known widgets, no duplicates across zones
    const ids = [...parsed.left, ...parsed.center, ...parsed.right];
    if (new Set(ids).size !== ids.length) return null;
    if (ids.some((id) => !WIDGETS[id])) return null;
    // Compact preset layouts legitimately omit the five machine widgets.
    const compact = ids.includes('machine');
    const required = compact
      ? Object.keys(WIDGETS).filter((id) => id !== 'machine' && !MACHINE_FIVE.includes(id))
      : Object.keys(WIDGETS).filter((id) => id !== 'machine');
    // Upgrade the previous layout without resetting custom widget placement.
    if (!compact && !ids.includes('spindle')) {
      const controlsIndex = parsed.right.indexOf('controls');
      parsed.right.splice(controlsIndex >= 0 ? controlsIndex + 1 : 0, 0, 'spindle');
      ids.push('spindle');
    }
    if (!ids.includes('cam')) {
      const connectionIndex = parsed.left.indexOf('connection');
      parsed.left.splice(connectionIndex >= 0 ? connectionIndex + 1 : 0, 0, 'cam');
      ids.push('cam');
    }
    if (!ids.includes('tooltest')) {
      const camIndex = parsed.left.indexOf('cam');
      parsed.left.splice(camIndex >= 0 ? camIndex + 1 : parsed.left.length, 0, 'tooltest');
      ids.push('tooltest');
    }
    if (required.some((id) => !ids.includes(id))) return null;
    return parsed;
  } catch {
    return null;
  }
}

export default function DockShell() {
  const [layout, setLayout] = useState(() => loadLayout() || DEFAULT_LAYOUT);
  const [closed, setClosed] = useState([]); // widget ids removed from layout
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('pcb-cnc-collapsed') || '{}');
      return Object.fromEntries(Object.keys(WIDGETS).filter(id => saved?.[id] === true).map(id => [id, true]));
    } catch { return {}; }
  });
  const [widths, setWidths] = useState(() => {
    try { return JSON.parse(localStorage.getItem('pcb-cnc-widths') || 'null') || { left: 300, right: 320 }; }
    catch { return { left: 300, right: 320 }; }
  });
  const [heights, setHeights] = useState(() => {
    try { return JSON.parse(localStorage.getItem('pcb-cnc-heights') || 'null') || {}; }
    catch { return {}; }
  });
  useEffect(() => onShowToolpath(() => {
    setLayout(previous => {
      if (Object.values(previous).some(zone => zone.includes('visualizer'))) return previous;
      return { ...previous, center: ['visualizer', ...previous.center] };
    });
    setClosed(previous => previous.filter(id => id !== 'visualizer'));
    setCollapsed(previous => ({ ...previous, visualizer: false }));
  }), []);
  const [drag, setDrag] = useState(null); // { id, fromZone }
  const [dropTarget, setDropTarget] = useState(null); // { zone, index }

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  }, [layout]);
  useEffect(() => {
    localStorage.setItem('pcb-cnc-widths', JSON.stringify(widths));
  }, [widths]);
  useEffect(() => {
    localStorage.setItem('pcb-cnc-heights', JSON.stringify(heights));
  }, [heights]);
  useEffect(() => {
    try { localStorage.setItem('pcb-cnc-collapsed', JSON.stringify(collapsed)); }
    catch { /* Collapsing remains available when browser storage is disabled. */ }
  }, [collapsed]);

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
    setCollapsed(previous => ({ ...previous, [id]: false }));
  };

  // Compact preset (ui-modes.md §8): swap the five machine widgets for the
  // single composite in-place; toggle back restores each to its old slot.
  // Layout math runs against the current state (not inside an updater) —
  // updaters must stay pure, and StrictMode double-invokes them.
  const compactOn = () => {
    const ids = [...layout.left, ...layout.center, ...layout.right];
    return ids.includes('machine') && MACHINE_FIVE.some((id) => !ids.includes(id));
  };
  const applyCompactPreset = () => {
    const ids = [...layout.left, ...layout.center, ...layout.right];
    const zones = { left: [...layout.left], center: [...layout.center], right: [...layout.right] };
    if (ids.includes('machine')) {
      // revert: put the five back where 'machine' sits
      for (const zone of Object.keys(zones)) {
        const i = zones[zone].indexOf('machine');
        if (i >= 0) {
          zones[zone].splice(i, 1, ...MACHINE_FIVE);
          break;
        }
      }
      setLayout(zones);
      setClosed((c) => c.filter((id) => !MACHINE_FIVE.includes(id)));
      return;
    }
    // apply: the five may live in DIFFERENT zones — remove every one, then
    // insert the composite at the position of the first removed widget.
    let insertAt = null;
    for (const zone of Object.keys(zones)) {
      const firstIdx = zones[zone].findIndex((id) => MACHINE_FIVE.includes(id));
      if (firstIdx >= 0 && insertAt === null) insertAt = { zone, index: firstIdx };
      zones[zone] = zones[zone].filter((id) => !MACHINE_FIVE.includes(id));
    }
    if (insertAt) zones[insertAt.zone].splice(Math.min(insertAt.index, zones[insertAt.zone].length), 0, 'machine');
    else zones.right.unshift('machine');
    setLayout(zones);
    setClosed((c) => [...new Set([...c, ...MACHINE_FIVE])]);
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

  // --- widget vertical resize ---
  const startWidgetResize = (id) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    // capture the base ONCE (slot height incl. handle+grip) — never re-measure
    // during the drag, otherwise set-height → re-measure → set-height compounds
    const slotEl = document.querySelector(`.widget-slot[data-widget="${id}"]`);
    const baseH = heights[id] ?? (slotEl ? slotEl.getBoundingClientRect().height : 200);

    // max: grow-widgets may expand to near-viewport; content-sized widgets cap
    // at their natural height (measured synchronously — no paint in between)
    let maxH = window.innerHeight - 140;
    if (!WIDGETS[id].grow && slotEl) {
      const prev = slotEl.style.height;
      slotEl.style.height = 'auto';
      maxH = Math.max(90, slotEl.getBoundingClientRect().height); // natural cap
      slotEl.style.height = prev;
    }

    const onMove = (ev) => {
      const next = Math.max(90, Math.min(maxH, Math.round(baseH + (ev.clientY - startY))));
      setHeights((h) => ({ ...h, [id]: next }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.classList.remove('resizing-v');
    };
    document.body.classList.add('resizing-v');
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const resetWidgetHeight = (id) => () => {
    setHeights((h) => {
      const next = { ...h };
      delete next[id];
      return next;
    });
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
        const isCollapsed = collapsed[id] === true;
        const isDropBefore = dropTarget?.zone === zone && dropTarget.index === i && drag;
        return (
          <div key={id}>
            {isDropBefore && <div className="drop-indicator" />}
            <div
              className={`widget-slot ${isCollapsed ? 'collapsed' : ''} ${drag?.id === id ? 'dragging' : ''}`}
              data-widget={id}
              style={isCollapsed ? { height: 'auto', flex: '0 0 auto' } : (heights[id] ?? W.defaultHeight) ? { height: heights[id] ?? W.defaultHeight, flex: '0 0 auto' } : undefined}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDropTarget({ zone, index: i }); }}
            >
              {/* visualizer flexes to fill unset space in the center column;
                  other widgets size to content (or their set height) */}
              <div
                className="widget-drag-handle"
                draggable
                onDragStart={(e) => { setDrag({ id, fromZone: zone }); e.dataTransfer.effectAllowed = 'move'; }}
                onDragEnd={() => { setDrag(null); setDropTarget(null); }}
                title="drag to rearrange"
              >
                <span className="grip">⠿</span>
                <span className="widget-title">{W.title}</span>
                <button
                  className="widget-collapse"
                  aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${W.title}`}
                  aria-expanded={!isCollapsed}
                  aria-controls={`widget-body-${id}`}
                  title={isCollapsed ? 'expand widget' : 'collapse widget'}
                  draggable={false}
                  onDragStart={event => { event.preventDefault(); event.stopPropagation(); }}
                  onClick={() => setCollapsed(previous => ({ ...previous, [id]: !previous[id] }))}
                >{isCollapsed ? '▸' : '▾'}</button>
                <button className="widget-close" aria-label={`Close ${W.title}`} onClick={() => closeWidget(id)} title="close widget">×</button>
              </div>
              {/* flex widgets (visualizer, g-code, console) stretch to the slot
                  and scroll internally; content widgets size to content and the
                  body scrolls if a manual height clamps below natural */}
              <div id={`widget-body-${id}`} hidden={isCollapsed} className={`widget-body ${W.flex ? 'widget-body-flex' : ''}`}>
                <W.component />
              </div>
              {!isCollapsed && <div
                className="widget-resize-grip"
                onMouseDown={startWidgetResize(id)}
                onDoubleClick={resetWidgetHeight(id)}
                title="drag: resize height · double-click: auto"
              >
                <span />
              </div>}
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
      <div className="layout-bar">
        <button
          className={`toggle ${compactOn() ? 'on' : ''}`}
          onClick={applyCompactPreset}
          title="Swap Connection, DRO, Status, Machine Controls and Spindle for the single compact Machine panel (and back)"
        >
          Compact machine {compactOn() ? 'on' : 'off'}
        </button>
        {closed.length > 0 && closed.map((id) => (
          <button key={id} onClick={() => restoreWidget(id)}>+ {WIDGETS[id].title}</button>
        ))}
      </div>
      {drag && <div className="drag-ghost">{WIDGETS[drag.id].title}</div>}
    </div>
  );
}
