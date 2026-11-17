export const COMPARISON_ANGLES = [15, 30, 45, 60, 75, 90];
export const TOOL_TEST_PATTERNS = [['coupon', 'Trace coupon with ticks'], ['angles', '10 mil angle comparison'], ['grooves', 'Separate depth grooves']];
export const TRACE_WIDTHS = [5, 10, 15, 20].map(mil => ({ mil, width: mil * 0.0254 }));
export const DEFAULT_TOOL_TEST = {
  pattern: 'coupon', markerDepth: -0.05,
  angle: 60, tip: 0.1, firstDepth: -0.02, lastDepth: -0.2, depthStep: 0.02,
  length: 30, pitch: 2, startX: 0, startY: 0, safeZ: 3,
  feed: 120, plunge: 40, rpm: 1000, spinup: 2
};
export const TOOL_TEST_FIELDS = [
  ['markerDepth', 'Tick depth (mm)'], ['angle', 'Included angle (°)'], ['tip', 'Tip diameter (mm)'],
  ['firstDepth', 'Shallow depth (mm)'], ['lastDepth', 'Deepest depth (mm)'],
  ['depthStep', 'Depth increment (mm)'], ['length', 'Test length (mm)'],
  ['pitch', 'Row spacing (mm)'], ['startX', 'Start X (mm)'], ['startY', 'Start Y (mm)'],
  ['safeZ', 'Safe Z (mm)'], ['feed', 'Cut feed (mm/min)'], ['plunge', 'Plunge feed (mm/min)'],
  ['rpm', 'Spindle (RPM)'], ['spinup', 'Spin-up (s)']
];
export const grooveWidth = (angle, tip, depth) => tip + 2 * Math.abs(depth) * Math.tan(angle * Math.PI / 360);
export function toolTestErrors(settings) {
  const errors = [];
  for (const [key, label] of TOOL_TEST_FIELDS) {
    if (!Number.isFinite(settings?.[key]) || Math.abs(settings[key]) > 1000000) errors.push(`Enter a valid ${label.toLowerCase()}.`);
  }
  if (errors.length) return errors;
  const s = settings;
  if (!TOOL_TEST_PATTERNS.some(([pattern]) => pattern === s.pattern)) errors.push('Choose a test pattern.');
  if (s.markerDepth > -0.000001) errors.push('Tick depth must be below work Z0.');
  if (s.angle <= 0 || s.angle >= 180) errors.push('Included angle must be greater than 0° and less than 180°.');
  if (s.tip < 0) errors.push('Tip diameter cannot be negative.');
  if (s.firstDepth > -0.000001 || s.lastDepth > -0.000001 || s.lastDepth > s.firstDepth) errors.push('Depths must be at least 0.000001 mm below Z0, with deepest depth at or below shallow depth.');
  for (const [key, label] of TOOL_TEST_FIELDS.filter(([key]) => ['depthStep', 'length', 'pitch', 'safeZ', 'feed', 'plunge', 'rpm'].includes(key))) {
    if (s[key] < 0.000001) errors.push(`${label} must be at least 0.000001.`);
  }
  if (!Number.isSafeInteger(s.rpm)) errors.push('Spindle RPM must be a whole number.');
  if (s.spinup < 0) errors.push('Spin-up time cannot be negative.');
  if (s.depthStep < 0.000001) errors.push('Depth increment must be at least 0.000001 mm.');
  if (s.lastDepth <= s.firstDepth && s.depthStep > 0 && Math.ceil((s.firstDepth - s.lastDepth) / s.depthStep - 1e-9) + 1 > 50) errors.push('Limit the test to 50 depth samples; increase the depth increment or reduce the depth range.');
  const angle = s.pattern === 'angles' ? Math.max(...COMPARISON_ANGLES) : s.angle;
  const widest = grooveWidth(angle, s.tip, s.lastDepth);
  if (s.pattern === 'coupon' || s.pattern === 'angles') {
    const traceWidth = s.pattern === 'angles' ? 0.254 : TRACE_WIDTHS.at(-1).width;
    if (s.pitch <= traceWidth + 2 * widest) errors.push(`Trace spacing must exceed the ${s.pattern === 'angles' ? '10' : '20'} mil trace width plus twice the widest estimated groove.`);
    const count = Math.ceil((s.firstDepth - s.lastDepth) / s.depthStep - 1e-9) + 1;
    if (s.length / count <= 2 * Math.max(widest, grooveWidth(angle, s.tip, s.markerDepth))) errors.push('Depth sections must be longer than twice the widest groove or tick; increase test length or reduce the number of depths.');
    if (grooveWidth(angle, s.tip, s.markerDepth) >= 0.4) errors.push('Tick grooves must be narrower than 0.4 mm; reduce tick depth or tip diameter.');
  } else if (s.firstDepth !== s.lastDepth && s.pitch <= widest) errors.push('Row spacing must exceed the widest estimated groove to keep samples separate.');

  return errors;
}
