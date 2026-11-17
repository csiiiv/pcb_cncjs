# PCB CNCjs

A PCB machining interface built with React, Vite and Three.js, using a
modified CNCjs backend for GRBL machine control and pcb2gcode for CAM.

The UI supports Gerber/Excellon import, isolation/drill/outline toolpaths,
surface probing and Z compensation, V-bit calibration, and explicit job
loading and execution.

## Repository scope

This repository contains the frontend, documentation, sample PCB files and
development launcher. The modified backend is included as the **`cncjs/` Git
submodule**, pointing at [csiiiv/cncjs](https://github.com/csiiiv/cncjs/tree/pcb-cnc).
The parent repository pins its exact commit; the fork's `pcb-cnc` branch
contains the PCB changes and `master` retains its upstream snapshot.

The upstream CNCjs checkout alone does not include this project's CAM API,
explicit-point autolevel support, sender progress changes or serial fixes.
See [development setup](docs/development.md) for installation, submodule
updates and contributing backend changes.

## Quick start

Clone both repositories:

```sh
git clone --recurse-submodules https://github.com/csiiiv/pcb_cncjs.git
cd pcb_cncjs
```

For an existing clone, run `git submodule update --init --recursive` first.
Install and build the backend using its checked-in Yarn release:

```sh
cd cncjs
node .yarn/releases/yarn-3.3.1.cjs install --immutable
node .yarn/releases/yarn-3.3.1.cjs build-prod
cd ..
```

Install the frontend and start both servers from the repository root:

```sh
npm --prefix frontend ci
./dev.sh
```

Use `./dev.sh --rebuild` after editing backend server modules. Override the
CAM executable with `PCB2GCODE_BIN=/absolute/path/to/pcb2gcode ./dev.sh`;
the launcher otherwise uses `$HOME/.local/bin/pcb2gcode`.
Open <http://localhost:5173/> for the PCB interface. The legacy CNCjs UI is
at <http://localhost:8000/>. Ctrl+C stops both servers. The launcher requires
Bash and `ss`; CAM generation also requires a separately installed compatible
pcb2gcode engine. See [development setup](docs/development.md) for details.

## Using the interface

| Mode | Purpose |
| --- | --- |
| Guided Milling | Default view: a board session with twelve stages from connection through inspection. |
| Tool Testing | V-bit coupons, angle comparison, probe repeatability and heightmap comparison. |
| Debug | Configurable dock with individual machine, CAM, probe, viewer and runner widgets. |

Switch modes in the header or with Ctrl/Cmd+1, 2 or 3. For Guided Milling,
choose **New board**, then follow the stage rail or footer's **next** action:

1. Connect; import PCB sources; generate and select a toolpath.
2. Mount the board and establish work XY and Z.
3. Verify the travel envelope; probe the surface and apply compensation,
   or explicitly skip those stages.
4. Mount the stated tool, re-zero Z after tool changes, load the previewed
   operation into the sender, resolve preflight warnings and arm/confirm Start.
5. Run the remaining operations, park and inspect the board.

CAM generation and preview loading do not start machining. The sender must
be loaded separately, including after changing or compensating a toolpath.

Settings, tool profiles and the workflow checklist use this browser's storage.
CAM source files/results, loaded G-code and the measured surface are held in
memory. Export CAM bundles, G-code and heightmaps before reloading; the saved
checklist does not restore a complete machining project or resume a job.

## Validation

```sh
cd frontend
node --test test/*.test.mjs test/patterns/*.test.mjs
npm run build
```

Verified on 2026-11-17 with Node.js 20.20.0 and npm 10.8.2: all 17 frontend
test files pass and the production build succeeds. Vite reports a large
bundle warning. These checks do not validate physical machining.

## Documentation

- [Development setup and repository boundaries](docs/development.md)
- [Project architecture, implementation status and roadmap](docs/project.md)
- [UI modes](docs/ui-modes.md) and [guided workflow](docs/workflow.md)
- [PCB CAM and pcb2gcode](docs/cam.md)
- [Surface probing and autolevel](docs/auto_level.md)
- [V-bit tool tests and saved profiles](docs/tool_test.md)
- [Settings and startup defaults](docs/settings.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Upstream references](docs/reference_urls.md)

Full project save/load, CAM bundle import, back-side alignment and selective
repair-job generation remain open work.
