// Cut-width swath rendering (ribbon geometry, width parsing, layer wiring).
// Run: node --test test/cutWidth.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { parseGcode } from '../src/jobs/parseGcode.js';
import { ribbonGeometry } from '../src/visualizer/ToolpathScene.js';
import { VIEWER_LAYERS, layerVisible } from '../src/visualizer/layers.js';
import { ToolpathScene } from '../src/visualizer/ToolpathScene.js';
import { loadCamOperation } from '../src/cam/preview.js';
import { viz, setViz } from '../src/visualizer/vizStore.js';

test('pcb2gcode tool comments attach widths to later paths', () => {
  const gcode = [
    'G21', 'G90',
    '(MSG, Change tool bit to mill diameter 0.20000mm)',
    'G00 Z3', 'G00 X4 Y4', 'G01 Z-0.08', 'G01 X16', 'G00 Z3',
    '(MSG, Change tool bit to mill diameter 1.50000mm)',
    'G00 X20', 'G01 Z-0.5', 'G01 X30', 'G00 Z3'
  ].join('\n');
  const job = parseGcode(gcode);
  assert.equal(job.paths.length, 2);
  assert.equal(job.paths[0].cutWidth, 0.2);
  assert.equal(job.paths[1].cutWidth, 1.5);
});

test('tool-test groove comments carry per-depth widths', () => {
  const gcode = [
    'G21', 'G90',
    '(Reference 1: Z-0.05 / estimated width 0.157 mm)',
    'G00 Z3', 'G00 X0 Y0', 'G01 Z-0.05', 'G01 X30', 'G00 Z3',
    '(Reference 2: Z-0.10 / estimated width 0.215 mm)',
    'G00 X0 Y2', 'G01 Z-0.1', 'G01 X30', 'G00 Z3'
  ].join('\n');
  const job = parseGcode(gcode);
  assert.equal(job.paths.length, 2);
  assert.equal(job.paths[0].cutWidth, 0.157);
  assert.equal(job.paths[1].cutWidth, 0.215);
});

test('unrelated comments do not produce widths; stray huge values are ignored', () => {
  const job = parseGcode('G21\n(Total board area 100.0 mm x 80 mm)\nG0 Z3\nG0 X0 Y0\nG1 Z-0.1\nG1 X5\nG0 Z3\n(MSG, Change tool bit to mill diameter 30mm)\nG0 X10\nG1 Z-0.1\nG1 X15\n');
  assert.equal(job.paths[0].cutWidth, null);
  assert.equal(job.paths[1].cutWidth, null);
});
test('CAM operations stamp diameters from settings on every path', () => {
  setViz({ scene: { setJob: () => {}, setRapids: () => {}, setPreviewCursor: () => {} } });
  const gcode = 'G21\nG90\nG00 Z3\nG00 X4 Y4\nG01 Z-0.08 F40\nG01 X16 F120\nG00 Z3\n';
  const job = loadCamOperation({ id: 'front', type: 'front', name: 'Front isolation', filename: 'front.ngc',
    tool: '0.2 mm isolation bit', gcode, settings: { isolation: { diameter: 0.25 } } });
  assert.equal(job.cutWidth, 0.25);
  assert.ok(job.paths.every((p) => p.cutWidth === 0.25));
  setViz({ scene: null, job: null, selection: null });
});

test('drill operations take hole width from the parsed bit-size comment', () => {
  setViz({ scene: { setJob: () => {}, setRapids: () => {}, setPreviewCursor: () => {} } });
  const gcode = 'G21\nG90\n(MSG, Change tool bit to drill size 0.8mm)\nG0 X5 Y5\nG1 Z-1.8\nG1 Z3\n';
  const job = loadCamOperation({ id: 'drill-1', type: 'drill', name: 'Drilling · 0.8mm drill', filename: 'drill-T1.ngc',
    tool: '0.8mm drill', gcode, settings: { drilling: { depth: -1.8, feed: 80, rpm: 12000 } } });
  assert.equal(job.cutWidth, 0.8);
  assert.ok(job.paths.every((p) => p.cutWidth === 0.8));
  setViz({ scene: null, job: null, selection: null });
});

test('ribbonGeometry offsets a straight cut by the half width', () => {
  const geo = ribbonGeometry(
    [new THREE.Vector3(0, 0, -0.1), new THREE.Vector3(10, 0, -0.1)],
    0.1
  );
  const pos = geo.attributes.position;
  assert.equal(pos.count, 4); // two edge points at each end
  // left edge y = +0.1, right edge y = -0.1 (cut along +X); float32 storage
  assert.ok(Math.abs(pos.getY(0) - 0.1) < 1e-6);
  assert.ok(Math.abs(pos.getY(1) + 0.1) < 1e-6);
  assert.ok(Math.abs(pos.getY(2) - 0.1) < 1e-6);
  assert.ok(Math.abs(pos.getY(3) + 0.1) < 1e-6);
  assert.equal(geo.index.count, 6); // two triangles
});

test('ribbonGeometry mitres 90° corners without gaps', () => {
  // L-shaped cut: +X then +Y. A miter join places the corner edge points on
  // the diagonal so both quads share the corner cross-section.
  const geo = ribbonGeometry(
    [new THREE.Vector3(0, 0, -0.1), new THREE.Vector3(5, 0, -0.1), new THREE.Vector3(5, 5, -0.1)],
    0.5
  );
  assert.ok(geo);
  const pos = geo.attributes.position;
  assert.equal(pos.count, 6); // 3 stations × 2 edge points
  // corner station: right-angle turn → miter offsets (∓c, ±c) with c = 0.5
  const c = 0.5;
  assert.ok(Math.abs(pos.getX(2) - (5 - c)) < 1e-6);
  assert.ok(Math.abs(pos.getY(2) - c) < 1e-6);
  assert.ok(Math.abs(pos.getX(3) - (5 + c)) < 1e-6);
  assert.ok(Math.abs(pos.getY(3) + c) < 1e-6);
  assert.equal(geo.index.count, 12); // two quads
});

test('ribbonGeometry skips pure-vertical plunges at the strip head', () => {
  const geo = ribbonGeometry(
    [new THREE.Vector3(0, 0, 3), new THREE.Vector3(0, 0, -0.1), new THREE.Vector3(10, 0, -0.1)],
    0.1
  );
  // the head point (index 0) is skipped: its outgoing direction is vertical
  const pos = geo.attributes.position;
  assert.equal(pos.count, 4);
  assert.ok(Math.abs(pos.getZ(0) + 0.1) < 1e-6);
  assert.ok(Math.abs(pos.getY(0) - 0.1) < 1e-6);
});

test('layer registry exposes the swath layer (factory default off, explicit off honored)', () => {
  const swath = VIEWER_LAYERS.find((l) => l.id === 'swath');
  assert.ok(swath);
  // raw semantics: a layer key absent from prefs means "on"; explicit false hides
  assert.equal(layerVisible({}, swath), true);
  assert.equal(layerVisible({ layers: {} }, swath), true);
  assert.equal(layerVisible({ layers: { swath: false } }, swath), false);
});

function sceneWithoutRenderer() {
  const scene = Object.create(ToolpathScene.prototype);
  scene.layerGroups = Object.fromEntries(VIEWER_LAYERS.map(({ id }) => [id, new THREE.Group()]));
  scene.toolpathGroup = scene.layerGroups.toolpaths;
  scene.rapidGroup = scene.layerGroups.rapids;
  scene.toolMarker = new THREE.Group();
  scene.layerGroups.tool.add(scene.toolMarker);
  scene.pathObjects = new Map();
  scene.hiddenPathIds = new Set();
  scene.swathGroup = scene.layerGroups.swath;
  scene.showSwath = false;
  scene.swathCount = 0;
  scene.previewLineObjs = [];
  scene.rulerGroup = null; // setJob skips rulers without it (headless tests)
  scene.applyVisibility = ToolpathScene.prototype.applyVisibility.bind(scene);
  return scene;
}

test('setJob builds swath meshes and dashed centre lines only when the layer is on', () => {
  const scene = sceneWithoutRenderer();
  const job = parseGcode('G21\n(MSG, Change tool bit to mill diameter 0.4mm)\nG0 Z3\nG0 X0 Y0\nG1 Z-0.1\nG1 X10 Y0\nG0 Z3\n');
  scene.setJob(job, { frame: false });
  assert.equal(scene.swathCount, 0);
  assert.ok(scene.toolpathGroup.children.every((l) => !l.material.isLineDashedMaterial));

  scene.setShowSwath(true);
  assert.equal(scene.showSwath, true);
  assert.equal(scene.swathCount, 1);
  assert.equal(scene.swathGroup.children.length, 1);
  assert.ok(scene.toolpathGroup.children.every((l) => l.material.isLineDashedMaterial));
  const entry = scene.pathObjects.get(1);
  assert.equal(entry.swathMeshes.length, 1);

  // hiding a path hides its ribbon too
  scene.hidePath(1);
  assert.equal(scene.swathGroup.children[0].visible, false);
  scene.showAll();
  assert.equal(scene.swathGroup.children[0].visible, true);

  scene.setShowSwath(false);
  assert.equal(scene.swathCount, 0);
  assert.ok(scene.toolpathGroup.children.every((l) => !l.material.isLineDashedMaterial));
});

test('drill paths render hole discs instead of ribbons', () => {
  const scene = sceneWithoutRenderer();
  const job = parseGcode('G21\n(MSG, Change tool bit to drill size 0.8mm)\nG0 X5 Y5\nG1 Z-1.8\nG1 Z3\n');
  assert.equal(job.paths[0].cutWidth, 0.8);
  scene.setJob(job, { frame: false });
  scene.setShowSwath(true);
  assert.equal(scene.swathCount, 1);
  assert.equal(scene.swathGroup.children[0].type, 'Mesh');
  assert.ok(scene.swathGroup.children[0].geometry.type === 'CircleGeometry');
});

test('toggling the swath preserves selection and hidden paths', () => {
  const scene = sceneWithoutRenderer();
  const job = parseGcode('G21\n(MSG, Change tool bit to mill diameter 0.4mm)\nG0 Z3\nG0 X0 Y0\nG1 Z-0.1\nG1 X10 Y0\nG0 Z3\nG0 X0 Y5\nG1 Z-0.1\nG1 X10 Y5\nG0 Z3\n');
  scene.setJob(job, { frame: false });
  scene.hidePath(2);
  scene.highlightPath(1);
  scene.setShowSwath(true);
  assert.equal(scene.hiddenPathIds.has(2), true);
  assert.equal(scene.selectedPathId, 1);
  assert.equal(scene.pathObjects.size, 2);
});
