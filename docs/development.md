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
└── cncjs/                  separate, ignored Git checkout; absent from a clone
```

The nested checkout tracks `https://github.com/cncjs/cncjs.git` as its
upstream. Its local modifications include:

- CAM routes in `src/server/api/api.cam.js` and services in `src/server/cam/`.
- GRBL explicit-point/test probing and work-coordinate probe results.
- Sender progress events used for execution tracking.
- Serial open/close cleanup and structured error handling.

Some backend work is still uncommitted in that checkout. Committing or
pushing the outer repository does not publish it. A runnable fresh-clone
setup still needs a separately published backend fork and a documented
revision. There is currently no fork URL or submodule to fetch automatically.
Do not substitute upstream CNCjs and expect the custom features to work.

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
the complete CNCjs distribution. Preparing a new backend checkout also needs
its own dependency installation and full build; follow that checkout's build
instructions once the modified fork is available.

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
./node_modules/.bin/jest src/server/cam/__tests__ --runInBand --coverage=false
```

These are separate from the outer repository's frontend checks. Some CAM
tests invoke the engine when available. See [cam.md](cam.md) for the backend
contract, limits and validation details.
