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
    setReady(true);
    onReady?.(scene);
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  return <div className={`viz-container ${ready ? '' : 'loading'}`} ref={containerRef} />;
}
