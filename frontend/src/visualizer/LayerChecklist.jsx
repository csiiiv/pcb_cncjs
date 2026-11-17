import { ParameterLabel } from '../ui/InfoIcon.jsx';
import { parameterHelp } from '../ui/parameterHelp.js';
import { useEffect } from 'react';
import { setVizPref, useViz } from './vizStore.js';
import { VIEWER_LAYERS, layerVisible } from './layers.js';

export default function LayerChecklist() {
  const { prefs, scene } = useViz();
  const swathOn = layerVisible(prefs, VIEWER_LAYERS.find((l) => l.id === 'swath'));

  useEffect(() => {
    if (!scene) return;
    for (const layer of VIEWER_LAYERS) {
      scene.setLayerVisibility(layer.id, layerVisible(prefs, layer));
    }
    // swath geometry only exists when the layer was on at setJob time
    scene.setShowSwath?.(swathOn);
  }, [prefs, scene, swathOn]);

  return (
    <details className="viz-layers" open>
      <summary>Layers</summary>
      <div className="viz-layer-list" role="group" aria-label="Toolpath layers">
        {VIEWER_LAYERS.map((layer) => (
          <label className="check-label" key={layer.id}>
            <input type="checkbox" checked={layerVisible(prefs, layer)}
              onChange={(e) => layer.pref
                ? setVizPref(layer.pref, e.target.checked)
                : setVizPref('layers', { ...prefs.layers, [layer.id]: e.target.checked })} />
            <ParameterLabel label={layer.label} help={parameterHelp('visualizer', layer.pref || `layers.${layer.id}`)} />
          </label>
        ))}
      </div>
    </details>
  );
}
