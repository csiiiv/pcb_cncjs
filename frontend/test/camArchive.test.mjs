import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { readCamArchive, detectSourceRole } from '../src/cam/archive.js';
const archive = (files) => zipSync(Object.fromEntries(Object.entries(files).map(([name, content]) => [name, strToU8(content)])));
const gerber = '%FSLAX24Y24*%\nM02*';
const drill = 'M48\nMETRIC,TZ\nT01C0.8\n%\nM30';

test('nested KiCad and conventional ZIP names map to the three CAM sources', () => {
  const { files, entries } = readCamArchive(archive({ 'board/pcb-F_Cu.gbr': gerber, 'board/pcb-Edge_Cuts.gbr': gerber,
    'board/pcb.drl': drill, 'board/pcb-B_Cu.gbr': gerber, 'board/pcb-F_Mask.gbr': gerber, 'README.txt': 'Read me' }));
  assert.deepEqual(Object.keys(files), ['front', 'drill', 'outline']);
  assert.equal(files.front.name, 'board/pcb-F_Cu.gbr');
  assert.equal(entries.length, 5);
  assert.equal(detectSourceRole('Copper.GTL', gerber), 'front');
  assert.equal(detectSourceRole('Outline.GKO', gerber), 'outline');
});

test('explicit Gerber layer attributes override misleading names', () => {
  assert.equal(detectSourceRole('front.gtl', '%TF.FileFunction,Copper,L2,Bot*%'), null);
  assert.equal(detectSourceRole('unusual.gbr', 'G04 #@! TF.FileFunction,Copper,L1,Top*'), 'front');
  assert.equal(detectSourceRole('unusual.gbr', '%TF.FileFunction,Profile,NP*%'), 'outline');
  assert.equal(detectSourceRole('board.txt', drill), 'drill');
  assert.equal(detectSourceRole('front_mask.gbr', gerber), null);
  assert.equal(detectSourceRole('top_silkscreen.gbr', gerber), null);
});

test('multiple front layers or drill sources remain unselected for user review', () => {
  const { files, entries } = readCamArchive(archive({ 'one.gtl': gerber, 'two.gtl': gerber, 'PTH.drl': drill, 'NPTH.drl': drill, 'edge.gko': gerber }));
  assert.deepEqual(Object.keys(files), ['outline']);
  assert.equal(entries.length, 5);
});

test('unknown Gerbers remain available for manual mapping', () => {
  const { files, entries } = readCamArchive(archive({ 'custom.gbr': gerber }));
  assert.deepEqual(files, {});
  assert.equal(entries[0].kind, 'gerber');
});

test('invalid, oversized, binary and unsafe-path ZIPs fail', () => {
  assert.throws(() => readCamArchive(strToU8('not a zip')), /ZIP|Gerber/);
  assert.throws(() => readCamArchive(archive({ '../front.gtl': gerber })), /invalid file path/);
  assert.throws(() => readCamArchive(archive({ 'front.gtl': '\0binary' })), /PCB text/);
  assert.throws(() => readCamArchive(archive({ 'large.gbr': 'X'.repeat(5 * 1024 * 1024 + 1) })), /5 MB/);
  assert.throws(() => readCamArchive(new Uint8Array(25 * 1024 * 1024 + 1)), /25 MB/);
  assert.throws(() => readCamArchive(archive({ 'README.txt': 'read me' })), /No Gerber/);
});
