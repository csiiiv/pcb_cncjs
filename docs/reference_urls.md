# PCB CNC Project – Reference URLs

This file collects the main upstream repositories, documentation, and source files relevant to the PCB CNC project.

Use this together with `PROJECT.md`.

---

# 1. CNCjs

## Main Repository

CNCjs source repository:

https://github.com/cncjs/cncjs

Primary reference for:

- CNCjs server
- GRBL communication
- Socket.IO architecture
- G-code streaming
- workflow handling
- machine state
- probing
- autolevel
- legacy frontend
- visualizer

---

## CNCjs README

https://github.com/cncjs/cncjs/blob/master/README.md

Useful for:

- installation
- command-line usage
- supported controllers
- basic CNCjs architecture

---

## CNCjs package.json

https://github.com/cncjs/cncjs/blob/master/package.json

Useful for:

- Node.js version requirements
- dependencies
- build commands
- development scripts
- frontend technology versions
- Electron/Linux packaging

Current project development scripts are defined here.

---

# 2. CNCjs GRBL Backend

## GRBL Controller

https://github.com/cncjs/cncjs/blob/master/src/server/controllers/Grbl/GrblController.js

This is one of the most important backend references.

Relevant functionality includes:

- GRBL communication
- machine state
- work position
- machine position
- G-code commands
- probing
- PRB handling
- autolevel commands
- feeder
- sender
- workflow
- reset/unlock operations

Any GRBL-specific backend extensions should be examined here first.

---

## GRBL Controller Tests

https://github.com/cncjs/cncjs/blob/master/src/server/controllers/Grbl/__tests__/GrblController.test.js

Useful when modifying:

- probing
- autolevel
- G-code execution
- controller state

Backend changes should ideally include corresponding tests here.

---

# 3. CNCjs Autolevel

## Autolevel Frontend Widget

https://github.com/cncjs/cncjs/blob/master/src/app/widgets/Autolevel/index.jsx

Useful for understanding:

- current probing workflow
- autolevel commands
- probe progress
- applying compensation
- saving/loading probe data

The existing UI is not intended to be reused directly, but its behavior is useful as a reference.

---

## Autolevel Backend Library

https://github.com/cncjs/cncjs/blob/master/src/server/lib/autolevel.js

Very important.

Contains:

- probe grid logic
- probe points
- interpolation
- compensation
- non-grid probe handling
- line subdivision
- surface calculations

Important for the future variable-density probing system.

The existing compensation system should be evaluated before replacing any of its math.

---

# 4. CNCjs Controller / Socket Interface

## Internal CNCjs Controller

https://github.com/cncjs/cncjs/blob/master/src/app/lib/controller/Controller.js

Useful for understanding:

- Socket.IO communication
- available commands
- controller events
- autolevel commands
- current frontend/backend interface

---

## Standalone cncjs-controller Repository

https://github.com/cncjs/cncjs-controller

This library provides an external JavaScript interface to the CNCjs server.

Useful for:

- connecting from a separate frontend
- sending CNCjs commands
- receiving machine events
- controlling serial ports
- G-code commands

Note:

The standalone package may not expose every newer event implemented by the current CNCjs repository.

When necessary, use the underlying Socket.IO connection directly or extend the client library.

---

# 5. CNCjs Custom Widget References

These are no longer the primary architecture for this project, but remain useful references for connecting a standalone frontend to CNCjs.

## Official Widget Boilerplate

https://github.com/cncjs/cncjs-widget-boilerplate

Useful for understanding:

- external frontend connection to CNCjs
- authentication token handling
- Socket.IO connection
- controller state
- CNCjs host configuration

---

## Widget Boilerplate package.json

https://github.com/cncjs/cncjs-widget-boilerplate/blob/master/package.json

Useful for:

- Vite configuration
- cncjs-controller dependency
- Socket.IO client version
- current widget development environment

---

# 6. CNCjs Visualizer

The old visualizer should be treated as a reference rather than copied wholesale.

Directory:

https://github.com/cncjs/cncjs/tree/master/src/app/widgets/Visualizer

---

## G-code Visualizer

https://github.com/cncjs/cncjs/blob/master/src/app/widgets/Visualizer/GCodeVisualizer.js

Important reference.

Shows how CNCjs currently converts:

```text
G-code
  ↓
gcode-toolpath
  ↓
G0 / G1 / G2 / G3 geometry
  ↓
Three.js
```

Also maintains a mapping between source G-code lines and rendered geometry.

This concept should be retained in the new visualizer.

---

## Viewport

https://github.com/cncjs/cncjs/blob/master/src/app/widgets/Visualizer/Viewport.js

Reference for:

- Three.js viewport
- camera behavior
- scene management

---

## Coordinate Axes

https://github.com/cncjs/cncjs/blob/master/src/app/widgets/Visualizer/CoordinateAxes.js

Reference for:

- XYZ coordinate rendering

---

## Grid

https://github.com/cncjs/cncjs/blob/master/src/app/widgets/Visualizer/GridLine.js

Reference for:

- machine/workspace grid rendering

---

## Cutting Pointer

https://github.com/cncjs/cncjs/blob/master/src/app/widgets/Visualizer/CuttingPointer.jsx

Reference for:

- current tool/cutter position visualization

---

## Probe Visualization

https://github.com/cncjs/cncjs/blob/master/src/app/widgets/Visualizer/ProbeVisualization.js

Very useful reference for:

- probe points
- probe surface
- surface geometry
- autolevel visualization

This should be studied when implementing the new probe-surface renderer.

---

# 7. CNCjs Axes / Work Coordinates

## Axes Display Panel

https://github.com/cncjs/cncjs/blob/master/src/app/widgets/Axes/DisplayPanel.jsx

Useful for understanding existing CNCjs commands for:

- Zero X
- Zero Y
- Zero Z
- Zero XY
- G54/G55/etc.
- work coordinate offsets
- machine zero commands

Important reference when implementing the new DRO and zeroing controls.

---

# 8. pcb2gcode

## Main Repository

https://github.com/pcb2gcode/pcb2gcode

This is the planned CAM engine.

Responsibilities:

```text
Gerber / Excellon
        ↓
pcb2gcode
        ↓
Nominal machining G-code
```

Use it for:

- isolation milling
- drilling
- outline routing
- front copper
- back copper
- multiple isolation passes
- CAM configuration

Do not make pcb2gcode responsible for runtime machine control.

---

## pcb2gcode Documentation / Manual

https://github.com/pcb2gcode/pcb2gcode/blob/master/man/pcb2gcode.1

This is the primary detailed reference for pcb2gcode options.

Important options to investigate include:

### Units

```text
--metric
--metricoutput
```

### Isolation milling

```text
--mill-diameters
--isolation-width
--milling-overlap
--zwork
--zsafe
--mill-feed
--mill-vertfeed
```

### Drilling

```text
--drill
--drill-feed
--drill-speed
--nog81
```

### Outline routing

```text
--outline
--cutter-diameter
--zcut
--cut-feed
```

### Tool changes

```text
--nom6
```

### Double-sided boards

Investigate:

- mirroring
- offsets
- front/back transformations
- alignment

---

# 9. pcb2gcode Configuration / millproject

pcb2gcode supports project/configuration files containing CAM options.

Use this capability so every PCB project stores a reproducible CAM configuration.

Typical application-generated configuration may contain:

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
```

Refer to the pcb2gcode manual for exact supported syntax.

---

# 10. gcode-toolpath

Repository:

https://github.com/cncjs/gcode-toolpath

Used by CNCjs's current visualizer.

Potential use:

```text
G-code
   ↓
motion callbacks
   ↓
structured geometry
```

This may either be reused directly or used as a behavioral reference for our own parser.

Important:

The new application should build a richer job model containing:

```text
Operation
Path
Segment
Source line
Modal state
Feed
Depth
```

rather than treating generated geometry as display-only data.

---

# 11. gcode-parser

Repository:

https://github.com/cncjs/gcode-parser

Used in CNCjs for parsing G-code lines.

Potential use:

- line parsing
- modal commands
- command words
- source G-code inspection

Evaluate whether this library, `gcode-toolpath`, or a combination best supports the new structured job model.

---

# 12. Three.js

Main site:

https://threejs.org/

Repository:

https://github.com/mrdoob/three.js

Documentation:

https://threejs.org/docs/

The new frontend should use a modern version of Three.js.

Do not copy old CNCjs APIs such as:

```js
new THREE.Geometry()
geometry.vertices.push(...)
```

Modern implementations should generally use:

```text
BufferGeometry
BufferAttribute
Line
LineSegments
Mesh
Raycaster
```

Important future features:

- toolpath rendering
- segment selection
- path selection
- raycasting
- PCB boundary
- probe surface
- tool position
- machining progress

---

# 13. React

Main documentation:

https://react.dev/

Use modern React for the replacement frontend.

Avoid inheriting CNCjs's React 15 architecture.

---

# 14. Vite

Documentation:

https://vite.dev/

Repository:

https://github.com/vitejs/vite

Recommended for the new frontend development environment.

Possible structure:

```text
frontend/
├── src/
├── public/
├── package.json
└── vite.config.js
```

---

# 15. GRBL

## Original GRBL Repository

https://github.com/gnea/grbl

Useful reference for:

- GRBL commands
- coordinate systems
- status reports
- probe behavior
- `$` commands
- realtime commands
- homing
- offsets

---

## GRBL Wiki

https://github.com/gnea/grbl/wiki

Important topics to review:

- G-code commands
- coordinate systems
- status reports
- probing
- configuration
- homing
- work coordinate offsets

---

# 16. GRBL Coordinate Systems

The project should primarily use work coordinates.

Important commands/concepts:

```text
G54
G55
G56
G57
G58
G59
```

Set current position as G54 zero:

```gcode
G10 L20 P1 X0 Y0
```

Set Z:

```gcode
G10 L20 P1 Z0
```

Machine coordinates are accessed using:

```gcode
G53
```

Avoid using machine coordinates for PCB geometry unless there is a specific diagnostic reason.

---

# 17. GRBL Probe Command

Typical probe command:

```gcode
G38.2 Z-2 F50
```

GRBL probe results are returned through the `PRB` report.

Remember:

```text
GRBL PRB
    ↓
reported in machine coordinates
    ↓
convert using work coordinate offset
    ↓
store as PCB/work coordinates
```

CNCjs already performs this conversion in its current GRBL autolevel backend.

Reference:

https://github.com/cncjs/cncjs/blob/master/src/server/controllers/Grbl/GrblController.js

---

# 18. Cursor

Main site:

https://www.cursor.com/

Documentation:

https://docs.cursor.com/

Cursor should be instructed to read:

```text
PROJECT.md
REFERENCES.md
```

before beginning major development phases.

Suggested instruction:

```text
Read PROJECT.md and REFERENCES.md completely before making architectural changes.

Work only on the requested project phase.

Before modifying CNCjs backend behavior, inspect the corresponding upstream implementation and explain why the modification is required.
```

---

# 19. Priority Source Files for Cursor

When beginning the project, inspect these first.

## CNCjs Backend

```text
src/server/controllers/Grbl/GrblController.js
src/server/lib/autolevel.js
```

URLs:

https://github.com/cncjs/cncjs/blob/master/src/server/controllers/Grbl/GrblController.js

https://github.com/cncjs/cncjs/blob/master/src/server/lib/autolevel.js

---

## CNCjs Client Communication

```text
src/app/lib/controller/Controller.js
```

URL:

https://github.com/cncjs/cncjs/blob/master/src/app/lib/controller/Controller.js

---

## CNCjs Machine Controls

```text
src/app/widgets/Axes/DisplayPanel.jsx
```

URL:

https://github.com/cncjs/cncjs/blob/master/src/app/widgets/Axes/DisplayPanel.jsx

---

## CNCjs Visualizer

```text
src/app/widgets/Visualizer/GCodeVisualizer.js
src/app/widgets/Visualizer/Viewport.js
src/app/widgets/Visualizer/ProbeVisualization.js
```

URLs:

https://github.com/cncjs/cncjs/blob/master/src/app/widgets/Visualizer/GCodeVisualizer.js

https://github.com/cncjs/cncjs/blob/master/src/app/widgets/Visualizer/Viewport.js

https://github.com/cncjs/cncjs/blob/master/src/app/widgets/Visualizer/ProbeVisualization.js

---

## pcb2gcode

Repository:

https://github.com/pcb2gcode/pcb2gcode

Manual:

https://github.com/pcb2gcode/pcb2gcode/blob/master/man/pcb2gcode.1

---

# 20. Recommended Reading Order

For a Cursor agent starting from scratch:

```text
1. PROJECT.md

2. REFERENCES.md

3. CNCjs package.json

4. CNCjs GrblController.js

5. CNCjs Controller.js

6. CNCjs Axes/DisplayPanel.jsx

7. CNCjs GCodeVisualizer.js

8. CNCjs autolevel.js

9. CNCjs ProbeVisualization.js

10. pcb2gcode manual
```

Do not attempt to understand the entire CNCjs repository before beginning.

Focus on the subsystems relevant to the current development phase.

---

# 21. Architectural Reminder

The intended responsibility split is:

```text
pcb2gcode
    ↓
CAM generation

our parser/job model
    ↓
structured machining geometry

our visualizer
    ↓
inspection / selection / editing

our probe planner
    ↓
physical PCB measurement

CNCjs
    ↓
machine execution

GRBL
    ↓
real CNC hardware
```

The project should preserve these boundaries unless there is a strong technical reason to change them.