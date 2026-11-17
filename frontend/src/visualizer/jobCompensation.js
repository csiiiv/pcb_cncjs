import { compensateGcode } from '../probe/compensate.js';
import { parseGcode } from '../jobs/parseGcode.js';
import { viz, setViz, showToolpath } from './vizStore.js';

export function applyJobCompensation(surface, maxSegLen = 2) {
  const original = viz.nominalJob;
  if (!original?.text) throw new Error('load G-code in the visualizer first');
  if (!surface?.triangleCount) throw new Error('no measured surface — probe first');
  const result = compensateGcode({ text: original.text, surface, maxSegLen });
  if (result.outside.length) {
    const first = result.outside[0];
    throw new Error(`${result.outside.length} cutting point${result.outside.length === 1 ? '' : 's'} outside the probed surface ` +
      `(first: line ${first.line} at ${first.x.toFixed(3)}, ${first.y.toFixed(3)}). ` +
      'Expand or refine the mesh to cover the toolpath.');
  }
  const parsed = parseGcode(result.text);
  for (const path of parsed.paths) {
    path.operationId = original.operationId;
    path.tool = original.tool;
  }
  const compensated = { ...original, ...parsed, text: result.text,
    name: `${original.name || 'job'} (compensated)`, nominal: false, cutWidth: original.cutWidth };
  setViz({ job: compensated, nominalJob: original, compensatedJob: compensated });
  return compensated;
}

export function revertJobCompensation() {
  if (!viz.compensatedJob || !viz.nominalJob) return;
  setViz({ job: viz.nominalJob, nominalJob: viz.nominalJob, compensatedJob: null });
}

/** Preview the raw CAM toolpath. Keeps a compensated copy so it can be shown again. */
export function showNominalPreview() {
  if (!viz.nominalJob) throw new Error('no raw toolpath to preview');
  setViz({ job: viz.nominalJob, nominalJob: viz.nominalJob, compensatedJob: viz.compensatedJob });
  showToolpath();
  return viz.nominalJob;
}

/** Preview the compensated toolpath built for the current operation. */
export function showCompensatedPreview() {
  if (!viz.compensatedJob) throw new Error('no compensated toolpath — apply compensation first');
  setViz({ job: viz.compensatedJob, nominalJob: viz.nominalJob, compensatedJob: viz.compensatedJob });
  showToolpath();
  return viz.compensatedJob;
}
