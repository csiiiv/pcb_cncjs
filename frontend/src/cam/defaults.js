export const DEFAULT_CAM_SETTINGS = {
  common: { safeZ: 3, changeZ: 5, spinup: 2, spindown: 1, zeroStart: true },
  isolation: { diameter: 0.2, width: 0.4, overlap: 50, depth: -0.08, feed: 120, plunge: 40, rpm: 12000 },
  drilling: { depth: -1.8, feed: 80, rpm: 12000 },
  outline: { diameter: 1, depth: -1.8, feed: 150, plunge: 40, rpm: 12000, infeed: 0.3,
    bridges: 1, bridgeCount: 4, bridgeZ: -1.2 }
};
