// Envelope-verification tour programs. Pure — no React, no machine access —
// so the reconciler/tests can import them directly (same split as parkPresets).

/**
 * Perimeter tour program: absolute G0 moves tracing bounds + margin at tourZ,
 * ending back at the start corner. The marker comment identifies the program
 * on the wire (console / logs) at a glance.
 * @param {{minX:number,maxX:number,minY:number,maxY:number}} box floor/ceil'd box
 * @param {number} tourZ clearance Z in work coordinates (above the board)
 */
export function boundsTourProgram(box, tourZ) {
  const z = Number(tourZ);
  return [
    'G21',
    'G90',
    `(verify envelope Z${z.toFixed(3)})`,
    `G0 Z${z.toFixed(3)}`,
    `G0 X${box.minX.toFixed(3)} Y${box.minY.toFixed(3)}`,
    `G0 X${box.maxX.toFixed(3)} Y${box.minY.toFixed(3)}`,
    `G0 X${box.maxX.toFixed(3)} Y${box.maxY.toFixed(3)}`,
    `G0 X${box.minX.toFixed(3)} Y${box.maxY.toFixed(3)}`,
    `G0 X${box.minX.toFixed(3)} Y${box.minY.toFixed(3)}`
  ];
}
