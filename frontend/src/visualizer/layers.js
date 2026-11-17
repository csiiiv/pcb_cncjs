// Viewer layers share the existing visualizer display preferences.
export const VIEWER_LAYERS = [
  { id: 'toolpaths', label: 'Cutting paths' },
  { id: 'swath', label: 'Cut width (actual size)' },
  { id: 'rapids', label: 'Rapid moves' },
  { id: 'probePoints', label: 'Probe points' },
  { id: 'probeMesh', label: 'Probe mesh' },
  { id: 'surface', label: 'Measured surface' },
  { id: 'zLabels', label: 'Probe Z labels', pref: 'showZLabels' },
  { id: 'travel', label: 'Probe travel', pref: 'showTravel' },
  { id: 'tool', label: 'Live tool position' },
  { id: 'preview', label: 'Preview cursor' },
  { id: 'repeatability', label: 'Repeatability test' },
  { id: 'comparison', label: 'Heightmap comparison' },
  { id: 'grid', label: 'Grid' },
  { id: 'axes', label: 'Work origin axes' },
  { id: 'rulers', label: 'Rulers' },
];

export function layerVisible(prefs, layer) {
  return layer.pref ? Boolean(prefs[layer.pref]) : prefs.layers?.[layer.id] !== false;
}