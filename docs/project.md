# PCB CNCjs Fork – Project Brief

# 0. Documentation Map & Implementation Status

> Reviewed 2026-11-17. This section records what actually exists in the
> repository; the numbered sections below remain the original specification.

## Documentation map

```text
README.md               repository overview and quick start
docs/development.md     setup, validation and separate-backend requirements
docs/project.md         this brief + per-phase status
docs/auto_level.md      autolevel / probe-mesh design brief + status
docs/cam.md             pcb2gcode CAM integration (Phase 5)
docs/tool_test.md       V-bit tool tests & saved tool profiles
docs/settings.md        component startup defaults
docs/workflow.md        twelve-stage workflow, operation execution and recovery limits
docs/ui-modes.md        Debug / Guided Milling / Tool Testing views and state lifetime
docs/troubleshooting.md serial lock / reopen failures (ModemManager + server close races)
docs/reference_urls.md  upstream references
```

Feature docs are authoritative for their subsystems; this brief tracks the
overall plan and phase status.

The published outer repository contains the frontend, docs, samples and
launcher. `cncjs/` is a separate, ignored local Git checkout; its modifications
are not included when this repository is cloned or pushed. No published
backend fork URL or submodule is configured yet. Backend-dependent entries
below describe the local workstation implementation. See
[development.md](development.md) for that boundary and setup requirements.

## Implementation status

```text
Phase 0  Fork & environment          done    cncjs/ nested repo (tracks upstream) + frontend/
Phase 1  Read-only state mirror      done    DRO (WPos primary), Status, Connection widgets
Phase 2  Basic machine controls      done    unlock/reset, jog (+diagonals), zero X/Y/Z/XY/XYZ,
                                             spindle widget
Phase 3  Parser + visualizer         done    parseGcode + Three.js scene, rulers, view presets
Phase 4  Interactive toolpaths       done    path/segment/region selection, hide/isolate, metadata
Phase 5  pcb2gcode CAM               done    see cam.md (ZIP import, setup wizard, per-bit drill
                                             split, outline tabs, tool profiles)
Phase 6  PCB project persistence     open    browser defaults/profiles + workflow diary, heightmap
                                             and CAM exports; CAM sources/results and viewer jobs
                                             remain in memory; no unified project save/load
Phase 7  Variable-density probe      done*   superseded by the auto_level.md probe-mesh design
                                             (triangular lattice + refinement + manual points);
                                             probe/plan.js grid planner is unused legacy
Phase 8  Explicit probe execution    done    autolevel:start points mode in GrblController
                                             (≤ 2000 pts, PRB→work coords server-side,
                                             update/complete events, cancel, test mode)
Phase 9  Surface model/compensation  done*   linear Delaunay surface + tinted visualization +
                                             subdividing Z compensation with coverage rejection;
                                             cubic/confidence layers still open
Phase 10 Integrated machining flow   done*   twelve-stage Guided wizard + Debug Job Runner,
                                             armed start, pause/resume/stop, per-ack progress,
                                             tool/Z records and operation outcomes; complete
                                             restart recovery and archives still open
Phase 11 Selective re-machining      open    selection exists; repair micro-job generator
                                             not built
Phase 12 Advanced PCB workflow       open    future
```

`*` = implemented with the noted qualifications; details in the linked docs.

Frontend layout and backend fork changes are listed in §39.

Validation on 2026-11-17: all 17 frontend test files pass and `npm run build`
succeeds with a large-bundle warning (Node.js 20.20.0, npm 10.8.2). This
review did not run backend tests or a physical machining cycle. Commands are
in [development.md](development.md).

## 1. Project Goal

Build a modern PCB-focused CNC workstation by **forking CNCjs** and using its proven machine-control backend while replacing most of its existing frontend with a purpose-built PCB workflow.

This is **not** intended to be a cosmetic redesign of CNCjs widgets.

The intended architecture is:

```text
Gerber / Excellon
        ↓
     pcb2gcode
        ↓
   Nominal G-code
        ↓
 Structured Job Model
        ↓
 Visualization / Editing
        ↓
 PCB Positioning
        ↓
 Variable-Density Probing
        ↓
 Surface Compensation
        ↓
      Milling
        ↓
     Inspection
        ↓
 Selective Re-machining
```

The final application should feel more like a dedicated **PCB machining workstation** than a generic G-code sender.

---

# 2. Existing Hardware / Environment

Current setup:

- Ubuntu Linux
- CNCjs already installed and working
- Desktop CNC connected through USB
- GRBL controller
- No limit switches / homing switches
- PCB milling is the primary use case
- Existing CNCjs installation can be retained during development as a fallback and diagnostic interface

Because the machine has no reliable homing reference:

> PCB operations must use **work coordinates**, not machine coordinates.

---

# 3. Coordinate-System Design

## 3.1 Work Coordinates Are Primary

Normal PCB workflow:

1. Mount PCB.
2. Jog spindle/tool to PCB origin.
3. Set work X/Y zero.
4. Probe or touch the PCB surface.
5. Set work Z zero.
6. Perform probing and machining relative to that work coordinate system.

Conceptually:

```text
             PCB

       Y
       ▲
       │
       │ ┌────────────────────┐
       │ │                    │
       │ │                    │
       │ │                    │
       └─●────────────────────┴──► X
        0,0

       PCB / G54 origin
```

The UI should emphasize:

```text
WORK POSITION

X
Y
Z
```

Machine position may still be shown for diagnostics but should not be used as the PCB coordinate reference.

## 3.2 Work Zero Commands

For G54:

```gcode
G10 L20 P1 X0
G10 L20 P1 Y0
G10 L20 P1 Z0
```

or:

```gcode
G10 L20 P1 X0 Y0
```

The PCB workflow should make `Zero XY` particularly easy.

---

# 4. Overall Architecture

CNCjs remains the machine-control engine.

pcb2gcode becomes the CAM engine.

The new frontend owns the operator workflow.

```text
┌──────────────────────────────────────────────┐
│              NEW PCB CNC UI                  │
│                                              │
│ Project / CAM                                │
│ Job Setup                                    │
│ G-code Visualization                         │
│ Machine Controls                             │
│ Probe Planner                                │
│ Surface Visualization                        │
│ Milling                                      │
│ Selective Repair                             │
│                                              │
└──────────────────────┬───────────────────────┘
                       │
            API / Socket.IO / CNCjs commands
                       │
             ┌─────────┴──────────┐
             ▼                    ▼
┌───────────────────────┐   ┌────────────────────┐
│    CNCjs Backend      │   │     pcb2gcode      │
│                       │   │                    │
│ Serial / USB          │   │ Gerber CAM         │
│ GRBL parser           │   │ Excellon CAM       │
│ G-code sender         │   │ Isolation paths    │
│ Workflow              │   │ Drill paths        │
│ Probe handling        │   │ Outline paths      │
│ Machine state         │   │                    │
│ Autolevel backend     │   │                    │
└───────────┬───────────┘   └────────────────────┘
            │
           USB
            │
            ▼
           GRBL
            │
            ▼
           CNC
```

---

# 5. Fork Strategy

Fork CNCjs but avoid heavily modifying its legacy frontend initially.

Preferred structure:

```text
cncjs-pcb/
│
├── src/
│   ├── server/
│   │   └── mostly upstream CNCjs backend
│   │
│   └── existing CNCjs sources
│
├── frontend/
│   ├── src/
│   │   ├── cnc/
│   │   ├── cam/
│   │   ├── project/
│   │   ├── machine/
│   │   ├── jobs/
│   │   ├── visualizer/
│   │   ├── probing/
│   │   └── remachining/
│   │
│   ├── package.json
│   └── vite.config.js
│
└── PROJECT.md
```

Keep:

```text
src/server/
```

as close to upstream CNCjs as practical.

Our frontend should primarily live in:

```text
frontend/
```

Backend changes should be small, explicit, and isolated.

Realized layout (differs from the sketch above):

```text
PCB-CNCJS/            outer repo: docs/, samples/, frontend/
cncjs/                nested git repo tracking upstream cncjs + fork changes
frontend/             new PCB UI (Vite + React 19)
```

---

# 6. Development Strategy

Initially keep both interfaces available.

Example:

```text
http://localhost:8000/
    Legacy CNCjs UI (cncjs/ backend)

http://localhost:5173/
    New PCB UI (Vite dev server)
```

The Vite dev server proxies `/api` and `/socket.io` to the CNCjs backend on
port 8000 (`frontend/vite.config.js`), so the new UI uses same-origin API
and socket URLs during development. On a workstation with the modified
backend and its production build, run `./dev.sh` from the outer repository
root; use `./dev.sh --rebuild` after backend server edits. See
[development.md](development.md) for separate-terminal commands,
authentication constraints and fresh-clone limitations.

The old interface remains useful during development as:

- diagnostic console
- GRBL status monitor
- fallback machine controller
- comparison reference
- emergency interface

Eventually the new UI can become the default.

---

# 7. Core UI Philosophy

Do not recreate CNCjs's generic widget system.

The UI should instead follow the actual PCB workflow.

```text
IMPORT PCB FILES
      ↓
GENERATE CAM
      ↓
INSPECT TOOLPATHS
      ↓
POSITION PCB
      ↓
ZERO XY
      ↓
ZERO / PROBE Z
      ↓
DEFINE PROBE MAP
      ↓
PROBE SURFACE
      ↓
REVIEW SURFACE
      ↓
APPLY COMPENSATION
      ↓
MILL
      ↓
INSPECT PCB
      ↓
OPTIONAL RE-MACHINING
```

---

# 8. PCB Project Model

The application should work with a persistent **PCB Project**, not just an individual G-code file.

Suggested model:

```text
PCBProject
│
├── source/
│   ├── frontGerber
│   ├── backGerber
│   ├── drillFile
│   └── outlineGerber
│
├── cam/
│   ├── pcb2gcodeVersion
│   ├── configuration
│   └── generatedMillProject
│
├── operations/
│   ├── frontIsolation
│   ├── backIsolation
│   ├── drilling
│   └── outline
│
├── probeMap
├── probeResults
├── surfaceModel
└── machineSetup
```

Each operation should contain:

```text
Operation
│
├── type
├── generatedGcode
├── parsedMoves[]
├── paths[]
│   └── segments[]
│
├── tool
├── depth
├── feed
├── compensationState
└── executionStatus
```

Example project status:

```text
FRONT ISOLATION
✓ CAM generated
✓ probed
✓ compensated
✓ machined

DRILLING
✓ CAM generated
○ not run

OUTLINE
✓ CAM generated
○ not run
```

---

# 9. pcb2gcode Integration

pcb2gcode should be integrated as the project's **CAM engine**.

Its responsibility:

```text
Gerber / Excellon
        ↓
    pcb2gcode
        ↓
Nominal machining G-code
```

It should NOT own the runtime probing workflow.

Responsibilities should remain separated:

```text
pcb2gcode
    CAM geometry
    isolation paths
    drilling
    outline

Our application
    work coordinates
    probing
    variable probe density
    surface interpolation
    autolevel compensation
    machine execution
    selective repair
```

---

# 10. pcb2gcode Backend Integration

Do not run pcb2gcode directly in the browser.

Preferred architecture:

```text
React frontend
      ↓
CAM API request
      ↓
Backend
      ↓
Generate pcb2gcode config / millproject
      ↓
Execute pcb2gcode process
      ↓
Capture stdout / stderr
      ↓
Read generated G-code files
      ↓
Return structured result
```

Example frontend request:

```js
{
    front: "board-F_Cu.gbr",
    drill: "board.drl",
    outline: "board-Edge_Cuts.gbr",

    units: "mm",

    isolation: {
        toolDiameter: 0.20,
        width: 0.40,
        depth: -0.08,
        feed: 120,
        plungeFeed: 40
    },

    outlineCut: {
        toolDiameter: 1.0,
        depth: -1.7,
        feed: 150
    }
}
```

---

# 11. CAM Configuration

Prefer generating a reproducible pcb2gcode configuration / `millproject`.

Conceptually:

```ini
metric=true
metricoutput=true

front=board-F_Cu.gbr
drill=board.drl
outline=board-Edge_Cuts.gbr

mill-diameters=0.20mm
isolation-width=0.40mm
milling-overlap=50%

zwork=-0.08mm
zsafe=3mm

mill-feed=120
mill-vertfeed=40

cutter-diameter=1.0mm
zcut=-1.7mm
cut-feed=150
```

Store the generated configuration with the PCB project.

This allows:

- reproducibility
- later editing
- regeneration
- project reopening
- audit of CAM parameters

---

# 12. GRBL-Oriented CAM Defaults

The application should use sane defaults for GRBL.

Prefer:

```text
Metric parameter units
Metric output
```

Avoid unsupported or undesirable canned cycles where appropriate.

Prefer ordinary moves over G81 drilling cycles.

Tool changes should initially be handled explicitly by the UI rather than blindly relying on automatic M6 behavior.

Example:

```text
Isolation finished.

CHANGE TOOL

Required:
1.00 mm end mill

[Tool Changed]
[Probe / Set Z]
[Continue]
```

---

# 13. CAM User Interface

The UI should expose meaningful pcb2gcode settings without exposing every obscure command-line option.

Example:

```text
ISOLATION MILLING

Tool diameter       0.20 mm
Isolation width     0.40 mm
Overlap             50 %
Cut depth          -0.08 mm
Feed                120 mm/min
Plunge feed          40 mm/min

[Generate Toolpaths]
```

Separate operation tabs:

```text
[ Front Isolation ]
[ Back Isolation ]
[ Drilling ]
[ Outline ]
```

More advanced pcb2gcode options may be placed under:

```text
Advanced Settings
```

---

# 14. CAM Preview

CAM generation should never immediately start machining.

Workflow:

```text
Gerber / Excellon
      ↓
Generate CAM
      ↓
Parse G-code
      ↓
VISUAL INSPECTION
      ↓
Approve
      ↓
Machine
```

Users should be able to inspect:

- isolation passes
- isolation width
- cutting order
- drilling locations
- outline
- bridges
- tool changes
- cut depth
- path spacing

---

# 15. G-code Job Model

Do not treat generated G-code only as raw text.

Parse it into structured geometry.

```text
Job
│
├── sourceGcode
│
├── parsedMoves[]
│
├── paths[]
│   │
│   ├── path 0
│   │   └── segments[]
│   │
│   ├── path 1
│   │   └── segments[]
│   │
│   └── ...
│
├── probeMap
├── probeResults
└── compensatedMoves
```

Example segment:

```js
{
    id: 183,
    pathId: 27,

    type: 'line',

    start: {
        x: 22.310,
        y: 14.750,
        z: -0.080
    },

    end: {
        x: 25.200,
        y: 14.750,
        z: -0.080
    },

    motion: 'G1',
    feed: 100,

    sourceLine: 472
}
```

Arc segments should retain:

- start
- end
- center
- radius where useful
- clockwise / counterclockwise
- source line
- feed
- modal state

---

# 16. Logical Machining Paths

Identify contiguous cutting paths.

Typical isolation path:

```gcode
G0 Z3
G0 X10 Y10

G1 Z-0.08
G1 X20 Y10
G1 X20 Y20
G1 X10 Y20

G0 Z3
```

This should become:

```text
Path 17
├── Segment 1
├── Segment 2
├── Segment 3
└── Segment 4
```

A retract followed by another plunge usually begins a new path.

These logical paths are essential for visualization and selective re-machining.

---

# 17. Visualizer

The visualizer is one of the application's central components.

Required support:

- G0
- G1
- G2
- G3
- coordinate grid
- work origin
- PCB boundary
- current cutter position
- operation colors
- machining progress
- probe points
- probe surface
- path highlighting
- segment highlighting
- zoom
- pan
- orbit

CNCjs's visualizer may be used as a reference, but prefer a modern Three.js implementation.

Do not unnecessarily inherit obsolete frontend dependencies from CNCjs.

---

# 18. Visualizer as an Editor

The visualizer should not merely display G-code.

It should drive:

```text
CAM inspection
probe planning
path selection
segment selection
repair selection
surface inspection
machining diagnostics
```

Conceptually:

```text
                   VISUALIZER
                       │
        ┌──────────────┼──────────────┐
        │              │              │
        ▼              ▼              ▼
      CAM           PROBING         REPAIR
        │              │              │
        └──────────────┼──────────────┘
                       ▼
                  CNC EXECUTION
```

---

# 19. Interactive Toolpath Selection

Support three primary selection modes:

```text
Path
Segment
Region
```

## 19.1 Path Selection

Click any portion of an isolation path and select the whole path.

Display:

```text
Front Isolation — Path 34

Length:          46.3 mm
Cut depth:       -0.080 mm
Feed:             120 mm/min
Tool:             0.20 mm
Segments:         18
```

Actions:

```text
Highlight
Isolate
Hide
Hide Others
Re-machine
Re-machine Deeper...
```

## 19.2 Segment Selection

Allow individual lines or arcs to be selected.

Example:

```text
Segments 7–11 selected

[Re-machine Selection]
```

## 19.3 Region Selection

Allow a rectangular or polygonal area to be drawn.

Select all machining geometry intersecting that region.

Example:

```text
[Re-machine Region]
```

This is especially useful after physically inspecting a finished PCB.

---

# 20. Visualizer Metadata

Rendered geometry must retain links to the internal job model.

Example:

```js
object.userData = {
    operationId: 'frontIsolation',
    type: 'toolpath',
    pathId: 27,
    segmentId: 183,
    sourceLine: 472
};
```

Raycasting should resolve:

```text
Mouse click
    ↓
Rendered geometry
    ↓
Segment
    ↓
Path
    ↓
Operation
    ↓
Original G-code
```

---

# 21. Path Visibility Controls

Dense PCB toolpaths can become visually cluttered.

Support:

```text
Highlight
Hide
Hide Others
Isolate
Show All
```

Example context menu:

```text
Front Isolation — Path 27

Highlight
Hide
Hide Others
Isolate
Re-machine
Re-machine Deeper...
```

---

# 22. Machine Controls

Required basic controls:

## DRO

Prominently show:

```text
WORK POSITION

X
Y
Z
```

Optionally show machine position below as diagnostic information.

## Jogging

Support:

```text
X+
X-
Y+
Y-
Z+
Z-
```

Selectable increments:

```text
0.01 mm
0.1 mm
1 mm
10 mm
```

Keyboard jogging may be added later.

## Work Zero

Controls:

```text
Zero X
Zero Y
Zero Z
Zero XY
```

---

# 23. CNC Communication Layer

All CNC-specific integration should remain isolated.

Suggested structure:

```text
frontend/src/cnc/
├── connection.js
├── controller.js
├── commands.js
├── events.js
└── state.js
```

Actual files: `connection.js`, `runtime.js`, `state.js`, `commands.js`,
`jobRunner.js`, `probe.js`, `spindle.js`, `errors.js` (events are bound in
`state.js` / `probe/store.js` rather than a separate events module).

Responsibilities:

- CNCjs connection
- GRBL connection
- controller state
- workflow state
- WPos
- MPos
- units
- alarms
- reset
- unlock
- jog
- G-code loading
- run
- pause
- resume
- stop
- probing events

Do not scatter CNCjs-specific communication logic through UI components.

---

# 24. Probe Planner

The previous PCB workflow used manually definable **variable probe density**.

This should be recreated and improved.

Support:

- PCB dimensions
- base probe grid
- configurable spacing
- dense rectangular regions
- dense polygonal regions
- manually inserted probe points
- point deletion
- duplicate removal
- point count
- path optimization later

Example:

```text
Base spacing:
10 mm

Dense region:
2 mm
```

Result:

```text
•         •         •         •

•     • • • • •     •         •
      • • • • •
•     • • • • •     •         •

•         •         •         •
```

The visualizer itself should be the probe-map editor.

---

# 25. Explicit Probe Point Support

The CNCjs backend should be enhanced to optionally accept explicit XY points.

Desired command concept:

```js
controller.command('autolevel:start', {
    mode: 'points',

    points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
        { x: 22, y: 2 },
        { x: 24, y: 2 }
    ],

    clearanceZ: 3,
    startZ: 1,
    endZ: -2,
    feedrate: 50
});
```

Existing rectangular grid behavior should remain available.

This backend change should remain isolated.

Status: implemented. `autolevel:start` accepts `mode: 'points'` with explicit
XY points (limit 2000), converts PRB results to work coordinates server-side,
and streams cumulative positions through `autolevel:update` /
`autolevel:complete`. A `test` mode probes the current XY once (touch probe /
repeatability test). Rectangular grid mode remains available upstream. See
[auto_level.md](auto_level.md).

---

# 26. Probe Data

Store probe results in work coordinates.

Example:

```js
[
    { x: 0,  y: 0,  z: 0.012 },
    { x: 10, y: 0,  z: 0.018 },
    { x: 20, y: 0,  z: 0.027 }
]
```

Store:

- X
- Y
- Z
- sequence index
- timestamp if useful
- validity
- potential confidence / outlier flags later

---

# 27. Probe Surface Visualization

Display:

- probe points
- measured Z values
- minimum Z
- maximum Z
- interpolated surface
- suspicious points
- outliers
- surface range

The surface should be toggleable over the G-code toolpath.

Example layers:

```text
✓ Toolpaths
✓ Probe Points
✓ Surface
✓ Tool Position
✓ PCB Boundary
```

---

# 28. Surface Compensation

Compensation concept:

```text
commandedZ(x,y)
    =
desiredCutDepth
    +
surfaceOffset(x,y)
```

The same measured surface must remain available after the main job.

It should also be used for repair operations.

Keep separately:

```text
nominal geometry
surface model
compensated geometry
```

Do not destructively overwrite the source geometry.

---

# 29. PCB Probe Workflow

Preferred sequence:

```text
Mount PCB
   ↓
Jog to PCB origin
   ↓
Zero XY
   ↓
Probe / touch PCB surface
   ↓
Zero Z
   ↓
Confirm PCB dimensions
   ↓
Generate probe map
   ↓
Adjust dense regions
   ↓
Probe surface
   ↓
Inspect measured surface
   ↓
Apply compensation
   ↓
Run machining operation
```

---

# 30. Main Machining Workflow

A PCB project may contain several operations:

```text
① Front Isolation
② Drilling
③ Outline
④ Back Isolation
```

Each operation should show:

- required tool
- status
- nominal depth
- feed
- compensation status
- completion state

Example:

```text
FRONT ISOLATION

Tool:        0.20 mm V-bit
Depth:      -0.080 mm
Feed:        120 mm/min
Compensated: Yes

[Preview]
[Run]
```

---

# 31. Tool Changes

Do not initially assume fully automated tool changes.

Workflow:

```text
Operation complete
       ↓
Tool change required
       ↓
Show required tool
       ↓
Operator changes tool
       ↓
Probe / reset Z if necessary
       ↓
Continue
```

Possible future support:

- remembered tool lengths
- tool setters
- automatic tool-length compensation

---

# 32. Selective Re-machining

Selective repair is a core feature.

Allow rerunning:

- entire path
- selected segments
- selected region

Do not simply resend arbitrary original G-code lines.

Instead generate a **self-contained repair micro-job**.

---

# 33. Repair Micro-job Generator

Workflow:

```text
Selected geometry
       ↓
Determine starting point
       ↓
Determine required modal state
       ↓
Safe retract
       ↓
Rapid to repair start
       ↓
Controlled plunge
       ↓
Execute selected path
       ↓
Lead-out if required
       ↓
Safe retract
```

Example:

```gcode
G21
G90
G17
G54

G0 Z3.000
G0 X25.200 Y10.000

G1 Z-0.080 F40
G1 X25.200 Y20.000 F100
G1 X30.500 Y20.000

G0 Z3.000
```

Generated repair jobs should explicitly establish important modal state.

Do not assume the machine is still in the same state as the original job.

---

# 34. Repair Depth Adjustment

A frequent PCB failure mode is insufficient isolation depth.

Support:

```text
Original depth:       -0.080 mm
Additional depth:     -0.010 mm
Effective depth:      -0.090 mm
```

Quick options could include:

```text
Original Depth
0.005 mm Deeper
0.010 mm Deeper
0.020 mm Deeper
Custom
```

Always preview before running.

---

# 35. Repair Lead-in / Lead-out

For a partial repair:

```text
A ── B ── C ── D ── E
```

If only:

```text
C ── D
```

is selected, optionally include surrounding path geometry:

```text
B → C → D → E
```

to reduce the need to plunge directly at the defective area.

Possible settings:

```text
No lead-in
0.5 mm
1.0 mm
Previous segment
Previous + next segment
```

---

# 36. Surface-Compensated Repairs

Repair operations should use the existing probe surface.

Conceptually:

```text
Selected XY repair path
        +
Original cut depth
        +
Optional extra depth
        +
Measured PCB surface
        ↓
Surface-compensated repair job
```

This is essential if the physical problem occurred because the PCB surface was uneven.

---

# 37. Post-Machining Repair Workflow

```text
Main job complete
      ↓
Inspect physical PCB
      ↓
Identify poorly cut area
      ↓
Click corresponding path
      ↓
Select:
Path / Segments / Region
      ↓
Optional extra depth
      ↓
Optional lead-in/out
      ↓
Preview repair
      ↓
Generate compensated micro-job
      ↓
Run repair
```

---

# 38. Job Execution Controls

Required:

```text
Start
Pause
Resume
Stop
Reset
Unlock
```

Display:

- GRBL state
- workflow state
- operation
- path
- segment
- current work position
- progress
- feed
- spindle state where available

Possible later features:

- feed override
- spindle override
- estimated remaining time
- operation timing
- job history

---

# 39. Suggested Frontend Modules

The originally suggested layout has evolved. The **actual** structure is:

```text
frontend/src/
│
├── cnc/                    # socket layer, state store, commands (§23)
│   ├── connection.js       #   CNCjs Socket.IO + auth token handling
│   ├── runtime.js          #   shared singletons (store, commands, runners)
│   ├── state.js            #   derived machine-state store over the event stream
│   ├── commands.js         #   unlock/reset, $J= jogs, G10 L20 zeroing, spindle
│   ├── jobRunner.js        #   gcode:load/start/pause/resume/stop
│   ├── probe.js            #   autolevel:start points mode + single-axis touch
│   ├── spindle.js          #   spindle eligibility / reported mode helpers
│   └── errors.js           #   connection error messages
│
├── cam/                    # PCB CAM widget state + REST client (Phase 5)
│   ├── client.js           #   authenticated /api/cam/status|generate
│   ├── store.js            #   per-session CAM store
│   ├── setup.js            #   setup-wizard steps + validation
│   ├── archive.js          #   in-browser Gerber ZIP import (fflate)
│   ├── defaults.js         #   default CAM settings
│   ├── preview.js          #   load operation into shared viewer
│   └── CamResults.jsx      #   per-operation results list
│
├── probe/                  # probe mesh / surface subsystem (auto_level.md)
│   ├── store.js            #   authoritative vertex mesh store
│   ├── wiring.js           #   probe-start gate (wiring-check modal store)
│   ├── lattice.js          #   initial triangular lattice
│   ├── mesh.js             #   Delaunay triangulation, measurement attach
│   ├── refine.js           #   refinement candidate engine
│   ├── tour.js             #   travel-optimized probe ordering
│   ├── surface.js          #   linear Delaunay surface (getZ)
│   ├── compensate.js       #   subdividing Z compensation
│   ├── heightmapFile.js    #   heightmap save/load/compare
│   ├── repeatability.js    #   per-spot / pooled probe statistics
│   ├── colormap.js         #   heightmap palettes
│   └── plan.js             #   LEGACY grid planner, unused (kept as reference)
│
├── visualizer/             # Three.js toolpath viewer
│   ├── ToolpathScene.js    #   scene, raycasting, layers, probe overlays
│   ├── ToolpathCanvas.jsx  #   canvas + ResizeObserver
│   ├── VisualizerWidget.jsx#   dock widget wrapper
│   ├── GcodePreviewWidget.jsx  # step-through G-code list widget
│   ├── LayerChecklist.jsx  #   layer visibility UI
│   ├── layers.js           #   layer definitions
│   ├── vizStore.js         #   shared viz state (job, selection, prefs)
│   ├── jobCompensation.js  #   apply/revert compensation in the viewer
│   ├── VisualizerPanel.jsx #   LEGACY standalone panel (unused; widgets supersede)
│   └── GcodePreviewPanel.jsx  # LEGACY standalone panel (unused)
│
├── widgets/                # dock components (DockShell.jsx hosts them)
│   ├── ConnectionWidget, DroWidget, StatusWidget, MachineControlsWidget,
│   ├── SpindleWidget, CamWidget + CamSetupModal, ToolTestWidget,
│   ├── VisualizerWidget, GcodePreviewWidget, ConsoleWidget, JobRunnerWidget,
│   ├── ProbeWidget, AutolevelWidget + HeightmapCompareModal +
│   ├── RepeatabilityTestModal, ConnectPromptModal
│
├── jobs/parseGcode.js      # structured path/segment job model (§15–16)
│
├── tooltest/               # V-bit test G-code generator + config
├── tools/                  # saved tool profiles (browser storage)
├── settings/               # startup-defaults schema + store + modal
├── machine/MachineControls.jsx  # legacy panel (superseded by the widget)
├── ui/                     # NumField, InfoIcon, ModalKit, parameterHelp
├── App.jsx                 # header + settings + connect prompt
├── DockShell.jsx           # draggable/resizable dock layout
└── main.jsx
```

`remachining/` and `project/` (Phase 6 / Phase 11) do not exist yet.

The original sketch, kept for reference:

```text
frontend/src/
│
├── cnc/
│   ├── connection.js
│   ├── controller.js
│   ├── commands.js
│   ├── events.js
│   └── state.js
│
├── cam/
│   ├── pcb2gcode.js
│   ├── camSettings.js
│   └── camProfiles.js
│
├── project/
│   ├── PCBProject.js
│   ├── ProjectStorage.js
│   └── Operation.js
│
├── machine/
│   ├── DRO.jsx
│   ├── JogControls.jsx
│   ├── WorkZero.jsx
│   └── MachineStatus.jsx
│
├── jobs/
│   ├── parseGcode.js
│   ├── JobModel.js
│   ├── Path.js
│   └── Segment.js
│
├── visualizer/
│   ├── GCodeViewer.jsx
│   ├── ToolpathRenderer.js
│   ├── CoordinateGrid.js
│   ├── PCBOutline.js
│   ├── ToolPosition.js
│   ├── SelectionManager.js
│   └── ProbeSurface.js
│
├── probing/
│   ├── ProbePlanner.jsx
│   ├── ProbeRegion.jsx
│   ├── generateProbePoints.js
│   ├── interpolation.js
│   └── compensation.js
│
├── remachining/
│   ├── SelectionPanel.jsx
│   ├── RepairSettings.jsx
│   ├── generateRepairJob.js
│   └── validateRepairJob.js
│
├── components/
│
├── App.jsx
└── main.jsx
```

Backend additions may eventually include:

```text
src/server/
│
├── cam/
│   └── pcb2gcode service
│
└── controller modifications
    └── explicit autolevel point support
```

Both exist now, in the `cncjs/` nested repo:

```text
cncjs/src/server/
├── api/api.cam.js                      # GET /api/cam/status, POST /api/cam/generate
├── cam/{config,pcb2gcode,operations}.js + __tests__/   # CAM service (Phase 5)
├── controllers/Grbl/GrblController.js  # autolevel points/test modes, per-ack
│                                       # sender:status, cumulative probe events
├── lib/serial-error.js + SerialConnection.js  # failed-open cleanup + error shaping
└── services/cncengine/CNCEngine.js     # fork wiring
```

`cncjs/` remains a separate Git repository for upstream integration. Its
current checkout contains a local sender-progress commit and additional
uncommitted backend changes. They are excluded from this outer repository;
publishing it does not back up the backend. Rebuild server modules after
backend changes (see [development.md](development.md)).

---

# 40. Safety Requirements

Development occurs against a real CNC machine.

During early development:

- read machine state first
- do not automatically move the machine
- do not automatically start jobs
- keep legacy CNCjs available
- clearly distinguish live controls from simulation/preview
- require explicit user action for motion

Before running generated jobs:

- verify work coordinate system
- verify safe Z
- verify tool
- verify depth
- verify feed
- verify operation
- preview path
- require explicit confirmation

Repair jobs should additionally validate:

- selected geometry
- lead-in
- lead-out
- compensation state
- effective depth
- expected starting point

---

# 41. Development Phases

The project should be implemented incrementally.

Each phase should leave the system in a usable/testable state.

---

## Phase 0 — Fork and Development Environment

Status: **done** (commit `cda2042`). The fork lives in `cncjs/` as a nested
git repository tracking upstream; the new UI lives in `frontend/`.

Goals:

- Fork CNCjs.
- Build CNCjs successfully from source.
- Confirm existing backend starts.
- Confirm USB / GRBL communication works.
- Keep legacy CNCjs frontend working.
- Create new `frontend/` project.
- Establish development scripts.

No new machine-control behavior yet.

Deliverable:

```text
Legacy CNCjs works
+
new empty frontend works
```

---

## Phase 1 — CNC Connection and Machine State

Status: **done** (commits `cda2042`→`7550331`). Connection/DRO/Status widgets
mirror the machine read-only; WPos is visually primary; `frontend/src/cnc/`
isolates all socket communication (§23).

Implement read-only integration.

Display:

- CNCjs connection
- GRBL connection
- GRBL state
- workflow state
- WPos X/Y/Z
- MPos X/Y/Z
- units
- alarm status

WPos should be visually primary.

No motion commands yet.

Deliverable:

```text
New frontend accurately mirrors machine state
```

---

## Phase 2 — Basic Machine Controls

Status: **done** (commit `7550331`, diagonal jogs added later). Unlock/reset,
jog cluster with diagonals, spindle controls, and zero X/Y/Z/XY/XYZ are live
through `MachineCommands` (G10 L20 zeroing, GRBL 1.1 `$J=` jogs).

Implement:

- unlock
- reset
- jogging
- Zero X
- Zero Y
- Zero XY
- Zero Z

Keep controls simple and explicit.

Deliverable:

```text
New UI can safely position and zero the machine
```

---

## Phase 3 — G-code Parser and Modern Visualizer

Status: **done** (commits `732bfd5`→`ca6323f`). `frontend/src/jobs/parseGcode.js`
builds the structured path/segment model; `frontend/src/visualizer/ToolpathScene.js`
renders with Three.js (BufferGeometry), including adaptive rulers, view presets,
live tool marker, and run-progress tracking.

Implement:

- load existing G-code
- parse G0/G1/G2/G3
- structured moves
- logical paths
- segments
- toolpath rendering
- work origin
- PCB outline where known
- cutter position

Do not integrate pcb2gcode yet.

Use known test G-code first.

Deliverable:

```text
Known G-code
   ↓
our parser
   ↓
our interactive visualizer
```

---

## Phase 4 — Interactive Toolpaths

Status: **done** (commit `a06f9b1`). Path/segment/region selection,
highlight/isolate/hide, metadata display, and a layer checklist are live.

Implement:

- click path
- click segment
- region selection
- highlight
- isolate
- hide
- show all
- operation/path metadata display

Deliverable:

```text
Toolpaths become selectable/editable objects
```

---

## Phase 5 — pcb2gcode CAM Integration

Status: **done**. Front isolation, per-bit
drilling, and tabbed-outline generation are available through the PCB CAM widget
and the authenticated CNCjs CAM API. Full PCB project persistence remains Phase 6.
Implementation and setup: [CAM integration](cam.md).

Integrate pcb2gcode.

Implement:

- import Gerber
- import Excellon
- configure isolation
- configure drilling
- configure outline
- execute pcb2gcode
- capture errors
- retain generated config
- parse generated G-code
- preview generated operations

Do not automatically start machining after CAM generation.

Deliverable:

```text
Gerber / Excellon
       ↓
pcb2gcode
       ↓
our parser
       ↓
our visualizer
```

---

## Phase 6 — PCB Project Workflow

Status: **open** (the next major phase). What persists today: startup
defaults ([settings.md](settings.md)), browser tool profiles
([tool_test.md](tool_test.md)), heightmap files, and the per-page-session CAM
store. A unified project file (sources + CAM config + operations + probe
surface + status) is not built yet.

Add project-level state.

Implement:

- source files
- CAM configuration
- multiple operations
- tool information
- operation state
- save project
- load project
- regenerate CAM

Deliverable:

```text
One PCB project contains all CAM and machining state
```

---

## Phase 7 — Variable-Density Probe Planner

Status: **done, superseded design**. The original rectangular grid + dense
rectangular regions planner was replaced by the probe-mesh approach specified
in [auto_level.md](auto_level.md): an initial triangular lattice, Delaunay
triangulation, interactive refinement (centroid / longest-edge / circumcenter
candidates), free-point placement, manual typed entry, and click deletion.
`frontend/src/probe/plan.js` (the old grid planner) is unused legacy kept only
as a reference.

The implemented scope covers:

- PCB bounds
- base grid
- custom spacing
- dense rectangular regions
- dense polygonal regions
- manual points
- point deletion
- duplicate elimination
- probe-count preview
- visualization

Deliverable:

```text
Interactive custom probe map
```

---

## Phase 8 — Explicit Probe Execution

Status: **done**. `GrblController.autolevel:start` accepts
`mode: 'points'` with explicit XY points (limit 2000), generates the
clearance → rapid → probe → retract G-code, converts PRB results to work
coordinates server-side, snaps map probes back to planned XY, and streams
cumulative results via `autolevel:update` / `autolevel:complete`.
Cancellation soft-resets GRBL. A `test` mode (touch / repeatability) probes
the current XY repeatedly for probe-quality statistics. Travel-optimized
probe ordering (nearest-neighbor + 2-opt vs serpentine vs exact for small
sets) runs client-side in `frontend/src/probe/tour.js`. See
[auto_level.md](auto_level.md).

Modify CNCjs backend minimally to accept explicit XY probe points.

Implement:

- probe start
- progress
- cancellation
- results
- work-coordinate probe storage
- error handling

Deliverable:

```text
Our custom probe map can be physically measured
```

---

## Phase 9 — Surface Modeling and Compensation

Status: **partially done — baseline complete**. The conservative linear
Delaunay surface (barycentric interpolation over fully measured triangles,
null outside coverage) is implemented in `frontend/src/probe/surface.js` with
tinted surface-mesh visualization and colormaps. G-code Z compensation
(`frontend/src/probe/compensate.js`) subdivides cutting moves (~2 mm), follows
the surface on rapids' counterparts, and rejects any cutting point outside the
probed hull instead of extrapolating. Heightmaps can be saved/loaded and
compared for reproducibility. Still open: smooth/cubic surface model,
linear-vs-cubic disagreement, confidence/uncertainty layer, error-driven and
toolpath-aware refinement (see auto_level.md "Desired Advanced Version").

Implement:

- probe-surface interpolation
- surface visualization
- outlier handling
- compensation
- compensated toolpath preview

Keep nominal geometry unchanged.

Deliverable:

```text
Nominal CAM
+
probe surface
=
compensated machining geometry
```

---

## Phase 10 — Integrated PCB Machining Workflow

Status: **mostly done**. CAM operations load straight into the shared
visualizer and Job Runner; Start is double-click-armed, Pause/Resume/Stop/
Force-stop exist, progress tracks real `(ln=N)` ack echoes, the G-code panel
follows execution, and switching viewer operations invalidates the sender's
loaded-job indicator. Tool-change workflow is manual (drill jobs are split
per bit; the operator mounts the stated tool and re-zeros Z). Operation
execution status/lifecycle tracking waits on Phase 6 project persistence.

Connect:

```text
Project
CAM
Tool setup
Zeroing
Probe
Compensation
Machining
```

Implement:

- operation execution
- Start
- Pause
- Resume
- Stop
- progress
- current path
- current segment
- tool-change workflow

Deliverable:

```text
Complete front-side PCB machining workflow
```

---

## Phase 11 — Selective Re-machining

Status: **open**. Path/segment/region selection exists (Phase 4), but the
repair micro-job generator (§32–37: modal-state establishment, lead-in/out,
depth adjustment, surface-compensated repair jobs) is not built yet.

Implement:

- rerun path
- rerun segments
- rerun region
- repair micro-job generator
- additional depth
- lead-in/out
- surface compensation
- repair preview
- repair execution

Deliverable:

```text
Visual inspection → select defect → safely repair
```

---

## Phase 12 — Advanced PCB Workflow

Possible later features:

- double-sided PCBs
- back-side CAM
- mirroring
- registration holes
- alignment pins
- side-flip workflow
- re-probing after flip
- multiple tool libraries
- tool-length offsets
- project history
- operation timing
- reusable CAM profiles
- automatic probe-density suggestions
- camera alignment
- fiducial recognition

---

# 42. Important Architectural Principles

## 42.1 Keep the CNCjs Backend

Do not rewrite:

- serial handling
- GRBL parsing
- G-code sender
- workflow
- realtime machine state

unless there is a strong reason.

---

## 42.2 Keep Backend Changes Small

Prefer:

```text
upstream CNCjs backend
+
small explicit extensions
```

Examples:

- explicit autolevel points
- pcb2gcode execution API
- project-support endpoints if necessary

---

## 42.3 Do Not Build on the Legacy UI

The old CNCjs frontend is useful as:

- reference
- diagnostic interface
- fallback

Do not build the new application by gradually accumulating more legacy widgets.

---

## 42.4 Work Coordinates Are the PCB Coordinate System

PCB geometry, probing, CAM placement, repairs, and visualization should all use work coordinates.

Do not depend on a reliable machine zero.

---

## 42.5 pcb2gcode Is CAM, Not Machine Control

pcb2gcode generates nominal machining geometry.

It should not determine:

- physical PCB origin
- runtime probing
- variable probe density
- machine state
- repair execution

Those belong to our application.

---

## 42.6 Preserve Source Geometry

Keep separate:

```text
source Gerber
CAM G-code
parsed nominal geometry
probe surface
compensated geometry
repair geometry
```

Never make it impossible to recover the original generated geometry.

---

## 42.7 The Visualizer Is a Core Interaction Surface

The visualizer should eventually control:

- CAM inspection
- probe planning
- path inspection
- selection
- repair
- diagnostics

It is not merely a preview.

---

## 42.8 Build and Test Incrementally

Do not attempt the entire application in one implementation pass.

Each phase should:

1. have clear scope;
2. preserve already-working functionality;
3. include tests where practical;
4. be validated against the real CNC only after software-level testing.

---

# 43. Initial Cursor Task

> Historical: Phase 0 and Phase 1 were completed first (commit `cda2042`).
> Subsequent phases through Phase 5 and Phases 8–10 followed. For current
> next-step planning see the status table in §0; the open work is Phase 6
> (project persistence), Phase 11 (selective re-machining), and the advanced
> autolevel items in auto_level.md.

Start with **Phase 0 and Phase 1 only**.

Tasks:

1. Read this entire `docs/project.md`.

2. Inspect the CNCjs repository and identify:
   - server startup
   - GRBL controller
   - Socket.IO architecture
   - controller state events
   - workflow state events
   - authentication requirements
   - how the frontend currently obtains WPos and MPos

3. Build CNCjs from source and document the development commands.

4. Create a modern frontend under:

```text
frontend/
```

5. Connect that frontend to the local CNCjs server.

6. Display:

```text
CNCjs connection
GRBL connection
GRBL state
workflow state

WORK POSITION
X
Y
Z

MACHINE POSITION
X
Y
Z

units
alarm state
```

7. Work position should be visually emphasized.

8. Do not implement jogging yet.

9. Do not send machine-motion commands yet.

10. Do not integrate pcb2gcode yet.

11. Do not modify the CNCjs backend unless genuinely required for the frontend connection.

12. Keep the existing CNCjs UI operational.

Before changing CNCjs backend code, explain why the change is necessary.

---

# 44. End Goal

The finished application should provide a continuous PCB manufacturing workflow:

```text
PCB DESIGN OUTPUT
       ↓
Gerber / Excellon
       ↓
pcb2gcode CAM
       ↓
Visual Toolpath Inspection
       ↓
PCB Positioning
       ↓
Variable-Density Probing
       ↓
Surface Compensation
       ↓
Machining
       ↓
Physical Inspection
       ↓
Interactive Selective Repair
```

CNCjs provides the machine-control foundation.

pcb2gcode provides CAM generation.

The new frontend ties them together into a purpose-built PCB machining environment.
