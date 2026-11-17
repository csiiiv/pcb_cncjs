import { grooveWidth, toolTestErrors, TRACE_WIDTHS, COMPARISON_ANGLES } from './config.js';
const round = value => Number(value.toFixed(6));
const word = value => String(round(value));

export function generateToolTest(settings) {
  const errors = toolTestErrors(settings);
  if (errors.length) throw new Error(errors.join(' '));
  const s = { ...settings };
  const comparison = s.pattern === 'angles';
  const coupon = s.pattern !== 'grooves';
  const maxAngle = comparison ? Math.max(...COMPARISON_ANGLES) : s.angle;
  const count = Math.ceil((s.firstDepth - s.lastDepth) / s.depthStep - 1e-9) + 1;
  const traceBaseY = s.startY + 2 + grooveWidth(maxAngle, s.tip, s.lastDepth);
  const referenceY = round(traceBaseY + TRACE_WIDTHS.length * s.pitch);
  let samples = Array.from({ length: count }, (_, index) => {
    const depth = round(Math.max(s.lastDepth, s.firstDepth - index * s.depthStep));
    return { index: index + 1, depth, width: grooveWidth(s.angle, s.tip, depth),
      x: round(s.startX + (coupon ? index * s.length / count : 0)),
      xEnd: round(s.startX + (coupon ? (index + 1) * s.length / count : s.length)),
      y: coupon ? referenceY : round(s.startY + index * s.pitch) };
  });
  const traceDefinitions = comparison ? COMPARISON_ANGLES.map(angle => ({ mil: 10, width: 0.254, angle })) : TRACE_WIDTHS;
  const traces = coupon ? traceDefinitions.map((trace, index) => ({ ...trace, y: round(traceBaseY + index * s.pitch) })) : [];
  if (comparison) samples = samples.flatMap(sample => traces.map((trace, index) => ({ ...sample,
    index: (sample.index - 1) * traces.length + index + 1, section: sample.index, angle: trace.angle,
    width: grooveWidth(trace.angle, s.tip, sample.depth), y: trace.y })));
  const tool = comparison ? `Angle comparison / ${word(s.tip)} mm tip` : `${word(s.angle)} deg V-bit / ${word(s.tip)} mm tip`;
  const lines = [
    comparison ? '(V-bit 10 mil angle comparison - depths step along +X)' : coupon ? '(V-bit trace coupon - depths step along +X)' : '(V-bit depth sweep - rows step along +Y)',
    '(Work Z0 is the material surface)', `(${tool})`,
    comparison ? '(Widths are geometric estimates; compare retained copper with a known 10 mil trace)' : '(Widths are geometric estimates; measure the reference grooves)',
    ...(comparison ? [`(10 mil traces from lower Y: ${COMPARISON_ANGLES.join(', ')} degrees included)`, '(All rows assume the same tip diameter; angles are hypotheses)', '(Ticks below traces mark section boundaries; every fifth tick is longer)'] : coupon ? ['(Retained copper traces from lower Y: 5, 10, 15, 20 mil)', '(Reference groove is above the four traces)', '(Ticks below traces mark section boundaries; every fifth tick is longer)'] : []),
    'G21', 'G90', 'G17', 'G54', 'G94', 'M5', `G0 Z${word(s.safeZ)}`,
    `G0 X${word(s.startX)} Y${word(s.startY)}`, `S${s.rpm} M3`, `G4 P${word(s.spinup)}`
  ];
  const cuts = [];
  const cut = (x, y, endX, endY, depth, kind, comment, width) => {
    cuts.push({ x: round(x), y: round(y), endX: round(endX), endY: round(endY), depth, kind });
    const widthNote = width != null ? ` / estimated width ${word(width)} mm` : '';
    lines.push(`(${comment}${widthNote})`, `G0 X${word(x)} Y${word(y)}`, `G1 Z${word(depth)} F${word(s.plunge)}`,
      `G1 X${word(endX)} Y${word(endY)} F${word(s.feed)}`, `G0 Z${word(s.safeZ)}`);
  };
  for (const sample of samples) {
    if (coupon) {
      for (const trace of traces) {
        if (comparison && trace.angle !== sample.angle) continue;
        // Offset each boundary by half the nominal trace plus half the cutter
        // width at this depth. Actual width deviations show on the copper strip.
        const offset = (trace.width + sample.width) / 2;
        for (const sign of [-1, 1]) cut(sample.x, trace.y + sign * offset, sample.xEnd, trace.y + sign * offset,
          sample.depth, 'trace', `${trace.mil} mil trace${comparison ? ` / assumed ${trace.angle} deg` : ''} / section ${sample.section ?? sample.index} / Z${word(sample.depth)}`, sample.width);
      }
    }
    if (!comparison) cut(sample.x, sample.y, sample.xEnd, sample.y, sample.depth, 'reference',
      `Reference ${sample.index}: Z${word(sample.depth)}`, sample.width);
  }
  if (coupon) {
    const tickWidth = grooveWidth(s.angle, s.tip, s.markerDepth);
    for (let index = 0; index <= count; index++) {
      const x = round(s.startX + index * s.length / count);
      cut(x, s.startY + 0.25, x, s.startY + (index % 5 === 0 ? 1.25 : 0.85), s.markerDepth, 'tick', `Depth boundary ${index}`, tickWidth);
    }
  }
  lines.push('M5', 'M2');
  const points = cuts.flatMap(path => [{ x: path.x, y: path.y }, { x: path.endX, y: path.endY }]);
  const layout = { minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)),
    minY: Math.min(...points.map(p => p.y)), maxY: Math.max(...points.map(p => p.y)) };
  return { id: 'tool-test', name: comparison ? 'V-bit 10 mil angle comparison' : coupon ? 'V-bit trace coupon' : 'V-bit depth sweep',
    filename: comparison ? 'v-bit-angle-comparison.ngc' : coupon ? 'v-bit-trace-coupon.ngc' : 'v-bit-depth-test.ngc',
    tool, gcode: lines.join('\n') + '\n', settings: s, samples, traces, cuts, layout };
}
