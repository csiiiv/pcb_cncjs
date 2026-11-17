export const CAM_SOURCES = [
  { role: 'front', section: 'isolation', label: 'Front copper', title: 'Isolation', accept: '.gbr,.ger,.gerber,.gtl' },
  { role: 'drill', section: 'drilling', label: 'Excellon drill', title: 'Drilling', accept: '.drl,.xln,.exc,.txt' },
  { role: 'outline', section: 'outline', label: 'Board outline', title: 'Outline', accept: '.gbr,.ger,.gerber,.gko,.gm1' }
];

export const CAM_FIELDS = {
  common: [['safeZ', 'Safe Z (mm)'], ['changeZ', 'Tool-change Z (mm)'], ['spinup', 'Spin-up (s)'], ['spindown', 'Spin-down (s)']],
  isolation: [['diameter', 'Tool Ø (mm)'], ['width', 'Isolation (mm)'], ['overlap', 'Overlap (%)'],
    ['depth', 'Depth (mm)'], ['feed', 'Feed (mm/min)'], ['plunge', 'Plunge (mm/min)'], ['rpm', 'Spindle (RPM)']],
  drilling: [['depth', 'Depth (mm)'], ['feed', 'Feed (mm/min)'], ['rpm', 'Spindle (RPM)']],
  outline: [['diameter', 'Tool Ø (mm)'], ['depth', 'Depth (mm)'], ['infeed', 'Depth/pass (mm)'],
    ['feed', 'Feed (mm/min)'], ['plunge', 'Plunge (mm/min)'], ['rpm', 'Spindle (RPM)'],
    ['bridges', 'Tab width (mm)'], ['bridgeCount', 'Tab count'], ['bridgeZ', 'Tab Z (mm)']]
};

export function camSetupSteps(files) {
  return [
    { id: 'files', title: 'Source files' },
    { id: 'common', title: 'Board setup' },
    ...CAM_SOURCES.filter((source) => files[source.role]).map((source) => ({ id: source.section, title: source.title })),
    { id: 'review', title: 'Review & generate' },
    { id: 'results', title: 'Toolpaths' }
  ];
}

export function camStepErrors(step, files, settings) {
  if (step === 'results') return [];
  if (step === 'files') return Object.keys(files).length ? [] : ['Import at least one Gerber or Excellon file to continue.'];
  if (step === 'review') return camSetupSteps(files)
    .filter(({ id }) => id !== 'review' && id !== 'results')
    .flatMap(({ id }) => camStepErrors(id, files, settings));
  const params = settings[step];
  const errors = [];
  for (const [key, label] of CAM_FIELDS[step] || []) {
    if (!Number.isFinite(params?.[key]) || Math.abs(params[key]) > 1000000) errors.push(`Enter a valid ${label.toLowerCase()}.`);
  }
  if (errors.length) return errors;
  if (step === 'common') {
    if (params.safeZ <= 0) errors.push('Safe Z must be above the PCB surface.');
    if (params.changeZ < params.safeZ) errors.push('Tool-change Z must be at least safe Z.');
    if (params.spinup < 0 || params.spindown < 0) errors.push('Spindle wait times cannot be negative.');
  } else {
    for (const key of ['diameter', 'width', 'infeed', 'feed', 'plunge', 'rpm']) {
      if (key in params && params[key] <= 0) errors.push(`${CAM_FIELDS[step].find(([field]) => field === key)[1]} must be positive.`);
    }
    if (params.depth >= 0) errors.push('Cut depth must be below work Z0 (a negative value).');
    if (!Number.isSafeInteger(params.rpm)) errors.push('Spindle RPM must be a whole number.');
    if (step === 'isolation') {
      if (params.width < params.diameter) errors.push('Isolation width must cover the tool diameter.');
      if (params.overlap < 0 || params.overlap >= 100) errors.push('Overlap must be at least 0% and less than 100%.');
    }
    if (step === 'outline') {
      if (params.bridges < 0 || !Number.isSafeInteger(params.bridgeCount) || params.bridgeCount < 0) errors.push('Tab width and count must be non-negative; count must be a whole number.');
      if (params.bridges > 0 && (params.bridgeCount < 1 || params.bridgeZ <= params.depth || params.bridgeZ > settings.common.safeZ)) errors.push('Tabs need a positive count and a Z above cut depth, no higher than safe Z.');
    }
  }
  return errors;
}
