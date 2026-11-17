// Height-map colormaps for probe vertices + measured surface tint.
// t = 0 (lowest measured Z) → t = 1 (highest). Data-anchored at both ends so
// the palette stays stable as measurements arrive (no rescaling jumps when a
// later extreme lands).

const clamp01 = (t) => Math.min(1, Math.max(0, t));

function lerp(a, b, t) { return a + (b - a) * t; }

// piecewise-linear interpolation over hex stops
function ramp(stops) {
  const rgb = stops.map((h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255]);
  return (t) => {
    const x = clamp01(t) * (rgb.length - 1);
    const i = Math.min(rgb.length - 2, Math.floor(x));
    const f = x - i;
    return [
      lerp(rgb[i][0], rgb[i + 1][0], f) / 255,
      lerp(rgb[i][1], rgb[i + 1][1], f) / 255,
      lerp(rgb[i][2], rgb[i + 1][2], f) / 255,
    ];
  };
}

export const COLORMAPS = {
  // classic low→high: blue → cyan → green → yellow → red (default)
  'blue-red': {
    label: 'Blue → Red',
    stops: [0x1e3a8a, 0x06b6d4, 0x22c55e, 0xfacc15, 0xdc2626],
  },
  // matplotlib viridis (perceptually uniform; great for flat boards)
  viridis: {
    label: 'Viridis',
    stops: [0x440154, 0x3b528b, 0x21918c, 0x5ec962, 0xfde725],
  },
  // matplotlib inferno (dark → bright; high contrast on dark UI)
  inferno: {
    label: 'Inferno',
    stops: [0x000004, 0x420a68, 0x932667, 0xdd513a, 0xfca50a, 0xfcffa4],
  },
  // terrain: water → land → peaks; intuitive for warped boards
  terrain: {
    label: 'Terrain',
    stops: [0x2c7bb6, 0xffff8c, 0xfdae61, 0xd7191c],
  },
  // grayscale: print-friendly, no hue bias
  gray: {
    label: 'Grayscale',
    stops: [0x101418, 0xf2f5f9],
  },
};

const compiled = Object.fromEntries(
  Object.entries(COLORMAPS).map(([name, def]) => [name, ramp(def.stops)])
);

/** Sample a colormap. t outside [0,1] is clamped. Returns [r,g,b] 0..1. */
export function colormapRGB(name, t) {
  const fn = compiled[name] || compiled['blue-red'];
  return fn(t);
}

/** CSS color for UI swatches/legends. */
export function colormapCSS(name, t) {
  const [r, g, b] = colormapRGB(name, t);
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
}

/** Map a Z value to t using measured min/max (single-value → 0.5). */
export function zToT(z, zMin, zMax) {
  if (!Number.isFinite(z) || !Number.isFinite(zMin) || !Number.isFinite(zMax)) return 0;
  if (zMax - zMin < 1e-9) return 0.5;
  return clamp01((z - zMin) / (zMax - zMin));
}

/**
 * Build a horizontal CSS gradient legend string.
 */
export function legendGradient(name) {
  const stops = [];
  for (let i = 0; i <= 10; i++) {
    stops.push(`${colormapCSS(name, i / 10)} ${i * 10}%`);
  }
  return `linear-gradient(to right, ${stops.join(', ')})`;
}
