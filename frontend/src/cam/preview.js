import { parseGcode } from '../jobs/parseGcode.js';
import { setViz, showToolpath } from '../visualizer/vizStore.js';

// Explicit diameters the server knows from CAM settings; drilled holes use
// the parsed drill-size comment (Excellon bit size == hole diameter).
const OP_WIDTHS = { front: 'isolation', outline: 'outline' };

export function loadCamOperation(operation) {
  const parsed = parseGcode(operation.gcode);
  if (!parsed.stats.cutSegments) throw new Error('This CAM operation contains no cutting moves');
  const settings = operation.settings || {};
  let width = OP_WIDTHS[operation.type] ? settings[OP_WIDTHS[operation.type]]?.diameter : undefined;
  if (operation.type === 'drill') {
    width = parsed.paths.map((path) => path.cutWidth).find((w) => w != null);
  }
  width = Number(width);
  if (!Number.isFinite(width) || width <= 0) width = null;
  for (const path of parsed.paths) {
    path.operationId = operation.id;
    path.tool = operation.tool;
    if (width != null) path.cutWidth = width;
  }
  const job = { ...parsed, name: operation.filename, text: operation.gcode,
    operationId: operation.id, operationName: operation.name, tool: operation.tool,
    cutWidth: width, nominal: true };
  setViz({ job, selection: null });
  showToolpath();
  return job;
}

export function downloadCamFile(name, content, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
