import { viz, setViz } from './vizStore.js';
import { getDefaults } from '../settings/store.js';
import { useEffect, useRef, useState } from 'react';
import { ToolpathScene } from '../visualizer/ToolpathScene.js';

// React wrapper for the imperative Three.js scene.
export default function ToolpathCanvas({ sceneRef, onSelect, onReady }) {
  const containerRef = useRef(null);
  const [ready, setReady] = useState(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const scene = new ToolpathScene(containerRef.current);
    sceneRef.current = scene;
    scene.onSelect = (sel) => onSelectRef.current?.(sel);
    scene.resize();
    scene.setView(getDefaults('visualizer').view);
    // apply the saved cut-width layer before any setJob so geometry is built once
    scene.showSwath = viz.prefs?.layers?.swath === true;
    scene.swathGroup.visible = scene.showSwath;
    setReady(true);
    onReady?.(scene);
    return () => {
      if (viz.scene === scene) setViz({ scene: null });
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  return <div className={`viz-container ${ready ? '' : 'loading'}`} ref={containerRef} />;
}
