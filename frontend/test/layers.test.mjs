import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VIEWER_LAYERS, layerVisible } from '../src/visualizer/layers.js';
import { ToolpathScene } from '../src/visualizer/ToolpathScene.js';

function sceneWithoutRenderer() {
  const scene = Object.create(ToolpathScene.prototype);
  scene.layerGroups = Object.fromEntries(VIEWER_LAYERS.map(({ id }) => [id, new THREE.Group()]));
  scene.toolpathGroup = scene.layerGroups.toolpaths;
  scene.rapidGroup = scene.layerGroups.rapids;
  scene.toolMarker = new THREE.Group();
  scene.layerGroups.tool.add(scene.toolMarker);
  scene.pathObjects = new Map();
  scene.hiddenPathIds = new Set();
  return scene;
}

test('default layers preserve display and reuse travel/Z-label preferences', () => {
  for (const layer of VIEWER_LAYERS) {
    assert.equal(layerVisible({}, layer), !layer.pref);
    assert.equal(layerVisible({ layers: { [layer.id]: false }, showTravel: true, showZLabels: true }, layer), Boolean(layer.pref));
  }
});

test('hidden layers remain hidden when rapid geometry and live position update', () => {
  const scene = sceneWithoutRenderer();
  scene.setLayerVisibility('rapids', false);
  scene.setRapids([{ start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 1, z: 1 } }]);
  assert.equal(scene.rapidGroup.children.length, 1);
  assert.equal(scene.rapidGroup.visible, false);
  scene.setLayerVisibility('tool', false);
  scene.setToolPosition({ x: 2, y: 3, z: 4 });
  assert.equal(scene.toolMarker.visible, true);
  assert.equal(scene.toolMarker.parent.visible, false);
  scene.setLayerVisibility('tool', true);
  scene.setToolPosition(null);
  assert.equal(scene.toolMarker.visible, false);
});

test('hidden measured surface remains hidden across replacement and clears old geometry', () => {
  const scene = sceneWithoutRenderer();
  scene.probeColormap = 'blue-red';
  scene.setLayerVisibility('surface', false);
  const vertices = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 1 }, { x: 0, y: 1, z: 2 }];
  scene.setSurface(vertices, [[0, 1, 2]]);
  const old = scene.surfaceMesh;
  scene.setSurface(vertices, [[0, 1, 2]]);
  assert.equal(old.parent, null);
  assert.equal(scene.layerGroups.surface.children.length, 1);
  assert.equal(scene.surfaceMesh.parent.visible, false);
  scene.setSurface([], []);
  assert.equal(scene.layerGroups.surface.children.length, 0);
});

test('layer visibility preserves individual path hiding and prevents region selection', () => {
  const scene = sceneWithoutRenderer();
  scene.hiddenPathIds.add(1);
  scene.setLayerVisibility('toolpaths', false);
  assert.deepEqual(scene.selectRegion({ x: 0, y: 0 }, { x: 10, y: 10 }), []);
  scene.setLayerVisibility('toolpaths', true);
  assert.equal(scene.hiddenPathIds.has(1), true);
});
