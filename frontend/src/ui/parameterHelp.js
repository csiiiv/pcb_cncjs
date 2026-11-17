// Shared explanations for saved defaults and the controls that use them.
const HELP = {
  connection: {
    serverUrl: 'Address of the CNCjs backend, including http:// or https:// and its port. Leave blank to use the frontend’s current server.',
    preferredPort: 'Serial device to select when it is available, such as /dev/ttyUSB0. Selecting a default does not open the port.',
    baudrate: 'Serial communication speed. It must match the controller firmware; GRBL commonly uses 115200 baud.',
    autoConnect: 'Attempt server + preferred machine port connection automatically each time the app loads. Only connection commands are sent; nothing moves.'
  },
  dro: { decimals: 'Number of decimal places shown for work and machine coordinates. This changes display precision only.', showMachine: 'Show absolute machine coordinates below the work-position readout.' },
  status: { showDetails: 'Show the controller’s units, work coordinate system, offsets, feed and pin state below its status banner.' },
  controls: {
    increment: 'Distance each axis travels per jog click, in millimetres. Diagonal jogging moves both X and Y by this distance.',
    feedXY: 'Requested speed for X/Y jogging in millimetres per minute.',
    feedZ: 'Requested speed for Z jogging in millimetres per minute.'
  },
  spindle: { rpm: 'Requested spindle speed in revolutions per minute. Changing this field does not send a command until you use the spindle controls.' },
  probe: {
    confirmWiring: 'Show the wiring-check confirmation (with the live probe-circuit lamp) before any probing move starts. A probe signal that never trips drives the tool the full travel into the board — keep this on unless you verify wiring every time.',
    axis: 'Axis used by the touch probe. Toward-contact commands move in the negative axis direction; away-contact commands move in the positive direction.',
    command: 'G38.2/G38.3 probe toward contact; G38.4/G38.5 probe away until contact opens. G38.2 and G38.4 alarm if the expected transition is not detected.',
    depth: 'Maximum probe travel in millimetres. Enter a positive distance; the selected command determines the direction.',
    feedrate: 'Speed during the probing move in millimetres per minute.',
    plate: 'Coordinate assigned to the probed axis at contact, in millimetres. For a Z touch plate this is the plate thickness above the work surface.',
    retract: 'Distance to move in the positive probe-axis direction after contact is recorded, in millimetres. For Z probing this lifts the tool away from the plate.'
  },
  autolevel: {
    clearanceZ: 'Work Z height used for XY travel between probe points. Choose a height that clears the board and fixtures.',
    startZ: 'Work Z height where the downward probing move starts. It must be no higher than clearance Z and above the probe end height.',
    endZ: 'Lowest work Z allowed during probing. The probe stops at contact or at this limit; it must be below start Z.',
    feedrate: 'Speed of the downward probing move in millimetres per minute.',
    minX: 'Left boundary of the initial probe grid in work coordinates, in millimetres.',
    maxX: 'Right boundary of the initial probe grid in work coordinates, in millimetres.',
    minY: 'Lower Y boundary of the initial probe grid in work coordinates, in millimetres.',
    maxY: 'Upper Y boundary of the initial probe grid in work coordinates, in millimetres.',
    spacing: 'Approximate distance between vertices in the triangular probe lattice. Smaller spacing adds points and takes longer to probe.',
    margin: 'Outward padding in millimetres added when using the loaded job’s bounds to define the probe area.',
    attempts: 'Number of measurements at each repeatability test spot. At least two measurements are needed to compare results.',
    mode: 'Burst repeats one spot before moving to the next. Cycled visits all spots on each pass, helping reveal changes over time.'
  },
  gcode: { followSelection: 'Scroll the G-code list to the source line selected in the toolpath viewer.', followRun: 'Scroll the G-code list to the executing line while a job runs.' },
  console: { autoscroll: 'Keep the serial console scrolled to the latest incoming or outgoing line.', hideStatus: 'Filter out GRBL <Idle|MPos:…> poll-rate status reports so real responses stay readable.' },
  tooltest: {
    pattern: 'Trace coupon isolates 5, 10, 15 and 20 mil copper strips across stepped-depth sections, with boundary ticks and a reference groove. Angle comparison uses six 10 mil traces assuming 15°, 30°, 45°, 60°, 75° and 90° included angles with the same tip diameter and stepped depths. Separate grooves cut one independent row at each depth.',
    markerDepth: 'Fixed negative depth used for the coupon’s tick marks, in millimetres relative to work Z0. Set deep enough to leave visible marks on your material.',
    angle: 'Full included angle of the V-bit, in degrees, not the angle of one side. A 60° bit uses 30° in the width formula.',
    tip: 'Flat tip diameter in millimetres. The groove widens from this diameter as the bit cuts deeper.',
    firstDepth: 'Shallowest test groove relative to the material surface at work Z0. Enter a negative depth in millimetres.',
    lastDepth: 'Deepest test groove relative to work Z0. Enter a negative value at or below the shallow depth. This endpoint is always included.',
    depthStep: 'Positive increase in cutting depth between separate grooves, in millimetres. The last increment may be smaller to include the deepest depth.',
    length: 'Total length along positive X, in millimetres. The trace coupon divides this length into equal depth sections.',
    pitch: 'Centre-to-centre spacing along positive Y, in millimetres. The coupon needs enough spacing for a 20 mil trace and its two isolation grooves.',
    startX: 'Work X coordinate of the start of every groove. Leave room for the bit width and test area.',
    startY: 'Work Y coordinate of the first groove. Separate grooves advance along positive Y by the row spacing. For the coupon, this is the lower tick-rail reference; traces are above it.',
    safeZ: 'Positive work Z clearance for rapid travel between test grooves, in millimetres. Work Z0 is the material surface.',
    feed: 'Requested speed for the straight X cutting moves, in millimetres per minute.',
    plunge: 'Requested speed for cutting down to each groove depth, in millimetres per minute.',
    rpm: 'Spindle speed written into the generated test G-code, in revolutions per minute.',
    spinup: 'Seconds to wait after spindle start before cutting the first groove.'
  },
  visualizer: {
    view: 'Camera orientation used when the viewer opens. Top and side views are orthographic; ISO uses perspective.',
    colormap: 'Palette for measured probe heights and the surface overlay. Colours scale between the lowest and highest measured Z.',
    showZLabels: 'Show numeric measured Z values beside probe vertices.',
    showTravel: 'Show the planned visiting order between probe points as a dashed travel path.',
    'layers.toolpaths': 'Show cutting paths from the loaded G-code.',
    'layers.swath': 'Show the actual swept cut area for paths with a known tool or cut width (CAM operations, drilled holes, tool-test grooves). Centre lines turn dashed while this is on. Widths come from CAM settings and comments in the G-code; paths without a width keep their centre line only. Compensation shifts the ribbon in Z with the path, not sideways.',
    'layers.rapids': 'Show non-cutting rapid travel moves from the loaded G-code.',
    'layers.probePoints': 'Show the vertices of the probe grid, including unmeasured points.',
    'layers.probeMesh': 'Show the triangle edges connecting probe vertices.',
    'layers.surface': 'Show the surface reconstructed from measured probe heights.',
    'layers.tool': 'Show the tool marker at the machine’s reported work position.',
    'layers.preview': 'Show the cursor for the selected G-code move.',
    'layers.repeatability': 'Show repeatability test spots and their travel overlay.',
    'layers.comparison': 'Show the overlay comparing two imported heightmaps.',
    'layers.grid': 'Show the reference grid in the toolpath viewer.',
    'layers.axes': 'Show the X/Y/Z axes at the work origin.',
    'layers.rulers': 'Show the viewer’s distance rulers.'
  }
};
const CAM_COMMON = {
  safeZ: 'Work Z clearance used for rapid travel above the PCB, in millimetres. All CAM Z values are relative to the PCB surface at work Z0.',
  changeZ: 'Work Z height for changing tools, in millimetres. It must be at least safe Z.',
  spinup: 'Seconds to wait after starting the spindle before cutting.',
  spindown: 'Seconds to wait after stopping the spindle.',
  zeroStart: 'Shift generated board coordinates so the design’s lower-left reference is at work XY0. This does not change the machine’s work offsets.'
};
const CAM_CUT = {
  diameter: 'Effective cutting diameter in millimetres. For a V-bit, use its width at the chosen cutting depth.',
  depth: 'Final cutting depth in millimetres below the PCB surface at work Z0. Enter a negative value.',
  feed: 'Cutting feed in millimetres per minute.',
  plunge: 'Feed for downward Z cutting moves in millimetres per minute.',
  rpm: 'Spindle speed requested in generated G-code, in revolutions per minute.',
  width: 'Total width of copper to clear around traces, in millimetres. It must be at least the effective tool diameter.',
  overlap: 'Percentage overlap between adjacent isolation passes. More overlap reduces the step between passes; use a value from 0 up to, but below, 100%.',
  infeed: 'Maximum outline cutting depth per pass, in millimetres. Enter a positive distance.',
  bridges: 'Width of holding tabs along the board outline, in millimetres. Set to 0 to cut without tabs.',
  bridgeCount: 'Number of holding tabs requested around the outline. Use a positive whole number when tab width is above 0.',
  bridgeZ: 'Work Z height left at the top of holding tabs, in millimetres. It must be above the final cut depth and no higher than safe Z.'
};
export function parameterHelp(section, key) {
  if (section === 'cam') {
    const [operation, field] = key.split('.');
    if (operation === 'common') return CAM_COMMON[field];
    if (operation === 'drilling' && field === 'feed') return 'Feed for drilling into the PCB, in millimetres per minute.';
    if (operation === 'outline' && field === 'diameter') return 'Diameter of the outline end mill, in millimetres.';
    return CAM_CUT[field];
  }
  return HELP[section]?.[key];
}
const LABEL_KEYS = {
  Depth: ['probe', 'depth'], Feed: ['probe', 'feedrate'], 'Plate thickness': ['probe', 'plate'], Retract: ['probe', 'retract'],
  Clearance: ['autolevel', 'clearanceZ'], 'Start Z': ['autolevel', 'startZ'], 'Probe to': ['autolevel', 'endZ'],
  'Min X': ['autolevel', 'minX'], 'Max X': ['autolevel', 'maxX'], 'Min Y': ['autolevel', 'minY'], 'Max Y': ['autolevel', 'maxY'],
  'Mesh spacing': ['autolevel', 'spacing'], 'Job margin': ['autolevel', 'margin'],
  'Attempts / spot': ['autolevel', 'attempts'], 'Passes (each spot probed per pass)': ['autolevel', 'attempts']
};
export const labelHelp = label => LABEL_KEYS[label] ? parameterHelp(...LABEL_KEYS[label]) : undefined;
export const sourceHelp = role => ({
  front: 'Gerber for front/top copper isolation. Select the copper layer you intend to mill; mask and silkscreen layers are not copper.',
  drill: 'Excellon file describing drill locations and bit diameters. If the ZIP has separate drill files, generate each separately.',
  outline: 'Gerber describing the board’s outer cut profile. Include it when it defines the shared reference extents of the design.',
  zip: 'Import a ZIP containing Gerber and Excellon files, including subfolders. Matching layers are selected automatically; review each selection. ZIP import replaces the current source set.'
})[role];
