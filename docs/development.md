# Development setup

Reviewed against the local source on 2026-11-17. The frontend checks pass
with Node.js 20.20.0 and npm 10.8.2 on Linux.

## Repository boundaries

```text
pcb_cncjs/                  this Git repository
├── README.md
├── dev.sh                  starts the two existing development servers
├── docs/
├── frontend/               React 19 + Vite + Three.js
├── samples/                Gerber archive, extracted sources and G-code fixtures
├── ntp-test/               standalone local NTP experiment, not used by the app
└── cncjs/                  Git submodule pinned to the modified CNCjs fork
```

The submodule's `origin` is `https://github.com/csiiiv/cncjs.git`. The PCB
changes are published on its `pcb-cnc` branch; `.gitmodules` records that
branch for explicit remote updates, while normal submodule initialization
checks out the exact commit pinned by this repository. The modifications include:

- CAM routes in `src/server/api/api.cam.js` and services in `src/server/cam/`.
- GRBL explicit-point/test probing and work-coordinate probe results.
- Sender progress events used for execution tracking.
- Serial open/close cleanup and structured error handling.

The fork keeps CNCjs history. The existing workstation also has an `upstream`
remote at `https://github.com/cncjs/cncjs.git`; new submodule clones only have
`origin` unless you add `upstream` yourself. Do not substitute upstream CNCjs
for the pinned fork and expect the custom features to work.

## Clone and initialize

```sh
git clone --recurse-submodules https://github.com/csiiiv/pcb_cncjs.git
cd pcb_cncjs
```

For an existing clone or after pulling a parent update:

```sh
git submodule update --init --recursive
```

A submodule normally has a detached HEAD at the recorded commit. This is
expected for running/building the application. Initialization downloads the
source, not dependencies, generated server/UI files or pcb2gcode.

## Backend installation and first build

Node.js 20.20.0 is the verified workstation version. Native serial dependencies
may require a local compiler/toolchain. Use the checked-in Yarn release without
installing Yarn globally, from the outer repository root:

```sh
cd cncjs
node .yarn/releases/yarn-3.3.1.cjs install --immutable
node .yarn/releases/yarn-3.3.1.cjs build-prod
cd ..
```

The full build creates `dist/cncjs/server-cli.js`, the server and the legacy
UI. Subsequent server-only edits can use `./dev.sh --rebuild`. The backend's
[fork notes](../cncjs/PCB-CNC.md) describe its changes and checks.

## Frontend installation and checks

```sh
cd frontend
npm ci
node --test test/*.test.mjs test/patterns/*.test.mjs
npm run build
npm run dev
```

The dev server uses port 5173 and proxies `/api` and WebSocket `/socket.io`
requests to `http://localhost:8000`. A successful frontend build does not
require CNCjs or pcb2gcode. Machine connection and CAM calls do.

`npm run preview` previews the built static assets; the current configuration
does not define a production deployment. Production hosting must also route
API and socket requests to CNCjs.

## Running the existing workstation

`dev.sh` requires Bash, `ss`, installed dependencies in both checkouts, an
executable `cncjs/bin/cncjs`, and an existing CNCjs production build containing
`dist/cncjs/server-cli.js`. It checks that ports 8000 and 5173 are free.

```sh
./dev.sh
```

The launcher starts CNCjs in production mode and Vite on `127.0.0.1:5173`.
It stops both processes on Ctrl+C or if either server exits.

After changes to backend server modules, stop the stack while idle and run:

```sh
./dev.sh --rebuild
```

This transpiles `cncjs/src/server` into `cncjs/dist/cncjs/server`, excluding
test directories, before starting. It does not install dependencies or create
the complete CNCjs distribution. A fresh clone needs the dependency installation
and full build above before using this server-only rebuild shortcut.

To run the existing backend and frontend in separate terminals:

```sh
# Terminal 1, from the repository root
cd cncjs
PCB2GCODE_BIN="$HOME/.local/bin/pcb2gcode" NODE_ENV=production ./bin/cncjs --port 8000
```

```sh
# Terminal 2, from the repository root
cd frontend
npm run dev
```

The PCB interface uses port 5173; the legacy CNCjs interface uses port 8000.

## CAM executable

CNCjs starts pcb2gcode per generation request. There is no separate CAM
service process. Install an engine supporting the capabilities in
[cam.md](cam.md), then either use the launcher's default
`$HOME/.local/bin/pcb2gcode` or provide an absolute path:

```sh
PCB2GCODE_BIN=/absolute/path/to/pcb2gcode ./dev.sh
```

The launcher warns if the engine is absent but still starts the UI. Use
**Check engine** in PCB CAM to inspect availability. CAM generation does not
require an open serial port.

## Connection and authentication

A blank **Settings → Connection → Server URL** uses the frontend's origin
and Vite proxy. **Connect** chooses the preferred port when present, otherwise
the first USB serial port, then the first listed port. The default baud rate
is 115200 and the controller type is GRBL.

The current client obtains a token from `/api/signin` with empty credentials,
which supports the CNCjs session-disabled configuration with no configured
users. It has no username/password sign-in form. An instance with configured
users needs additional authentication support before this client can sign in.
See [troubleshooting](troubleshooting.md) for serial-port failures.

## Backend checks

With the modified backend and its development dependencies installed:

```sh
cd cncjs
PCB2GCODE_BIN="$HOME/.local/bin/pcb2gcode" ./node_modules/.bin/jest src/server/cam/__tests__ src/server/lib/__tests__/SerialConnection.test.js src/server/controllers/Grbl/__tests__/GrblController.test.js --runInBand --coverage=false '--modulePathIgnorePatterns=<rootDir>/(dist|output|build)/'
```

Validated on 2026-11-17: 4 suites, 99 tests passed, including real pcb2gcode
generation. The server source also compiled successfully with Babel to a
temporary output directory. These are separate from the frontend checks and
do not exercise physical machinery. The engine test skips when pcb2gcode is
unavailable. See [cam.md](cam.md) for the backend contract and limits.

## Updating and contributing

After pulling updates to the parent repository, synchronize the pinned backend:

```sh
git pull --ff-only
git submodule update --init --recursive
```

Commit any local backend work before switching revisions. To develop on the
fork's PCB branch, attach it explicitly and check its current state:

```sh
git -C cncjs switch pcb-cnc
git -C cncjs status
```

Commit and push backend changes to `origin pcb-cnc` first. Then record the
new revision in the parent repository:

```sh
git add cncjs
git commit -m "Update CNCjs backend revision"
git push origin main
```

The parent stores a commit reference, not the backend's files or uncommitted
changes. `git submodule update --remote cncjs` deliberately advances to the
fork branch's latest commit; review, build/test and commit that change before
sharing it. Normal setup should use the pinned revision instead.
