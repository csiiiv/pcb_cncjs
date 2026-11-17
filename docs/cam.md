# pcb2gcode integration — Phase 5

The CAM routes and engine service described here live in the separate,
ignored `cncjs/` backend checkout. They are not bundled in this repository.
See [development setup](development.md) before configuring a fresh clone.

The **PCB CAM** dock widget imports front-copper Gerber, Excellon drill, and
outline Gerber files through **Setup CAM**, a guided side modal. Import sources,
choose the shared board clearance/origin, configure each selected operation, then
review and **Generate toolpaths**. Steps for unused operations are skipped. **Back**
returns to earlier settings; closing setup retains files and settings. **Edit setup**
reopens the guide and **Generate again** opens the review step using current settings.
Inspect each operation with **Load G-code**,
then explicitly load the chosen operation in Job Runner. Generation and loading into the viewer
do not send machine commands. **Load G-code** uses the same viewer/parser as
loading a G-code file in Toolpath, and restores the Toolpath panel if it is closed. A machine port need not be connected to generate.

## ZIP import

In the source-files step, choose a **Gerber ZIP** or import individual files.
ZIPs may contain subdirectories. Importing a ZIP replaces the selected source set.
Front copper and outline are matched using Gerber `FileFunction` attributes when
present, then common filenames such as `.gtl`, `F_Cu`, `.gko`, and `Edge_Cuts`.
Excellon `.drl`, `.xln`, `.exc`, and drill `.txt` files are recognized. Unknown
Gerbers can be assigned using the source dropdowns. Review these selections before
continuing; bottom copper, solder mask and silkscreen are not selected automatically.

When multiple files match an operation, choose the desired source explicitly.
The current backend accepts one drill source per generation: generate plated and
non-plated drill files separately if both are present. ZIP import does not combine
them or establish back-side alignment. Individual file import can override any
ZIP selection. Failed ZIP imports retain the previous selected sources.

Archives are decoded in the browser. Only the selected text sources go to CNCjs.
Limits: 25 MB compressed ZIP, 500 archive entries, 5 MB per PCB source and 30 MB
total decoded PCB text. Files are never extracted onto the backend filesystem.

## Engine and backend setup

The engine must support `mill-diameters`, `isolation-width`, `nog91-1`,
`cut-vertfeed`, and `nog64`. The status endpoint checks these capabilities rather
than assuming an old distribution package supports them.

This development machine uses the upstream [pcb2gcode 3.0.4 release](https://github.com/pcb2gcode/pcb2gcode/releases/tag/v3.0.4):

- Launcher: `/home/temp/.local/bin/pcb2gcode`
- Engine and user-local libraries: `/home/temp/.local/share/pcb-cnc/pcb2gcode-3.0.4/`
- Libraries: the release's `libgerbv.so.1` and Ubuntu Noble's
  `libboost_program_options.so.1.83.0`; no system packages were changed.

On another machine install a compatible pcb2gcode release and put the executable
on the backend's PATH, or set `PCB2GCODE_BIN` to its executable/launcher path.
The launcher must work from any current directory because generation runs in a
temporary directory. The upstream archive's installer script is not suitable as
the CAM executable.

After backend source changes, rebuild its server modules:

```sh
cd cncjs
NODE_ENV=production ./node_modules/.bin/babel src/server --out-dir dist/cncjs/server --ignore '**/__tests__/**'
```

Restart the backend when the machine is idle. `./dev.sh --rebuild` from the
outer root rebuilds the server and starts both servers on an existing
workstation. For a separate foreground backend start from `cncjs/`:

```sh
PCB2GCODE_BIN="$HOME/.local/bin/pcb2gcode" NODE_ENV=production ./bin/cncjs --port 8000
```

There is no separate CAM daemon to start: CNCjs launches pcb2gcode for each
**Generate toolpaths** request.

Run the frontend using `npm run dev` in `frontend/`. Its existing `/api` proxy
reaches the CAM endpoints on CNCjs. **Check engine** reports missing engine,
missing capabilities, authentication failures, or an older backend without CAM
routes. An existing CNCjs process must restart to load the rebuilt routes.

Use the [Tool Test component](tool_test.md) to generate a trace coupon or V-bit
depth sweep. Save measured depth/diameter/feed/RPM calibrations as named tool
profiles, then select and apply a profile in PCB CAM before generating. Profiles
persist in this browser and indicate whether their width was measured or estimated.

## Configuration and coordinates

All numeric parameters and output are metric. Safe Z and tool-change Z refer to
work coordinates; tool-change Z must be at least safe Z. Cut depths must be below
work Z0. Settings include isolation diameter/width/overlap, feeds, spindle RPM,
drilling depth, outline depth per pass, and holding tabs. Defaults are starting
values for review and must be adjusted for the mounted tools and material.

**Place board lower-left at work XY0** enables pcb2gcode's `zero-start`. Disabling
it retains the source design coordinates. Uploaded sources are generated together
in one run so operations share the same origin. Import the outline with the
copper/drill sources when it defines the board's reference extents. Regenerating
with different source extents can change the origin; inspect the preview and
mounted-board alignment again. This does not change the machine's work offsets.

The generated `millproject` uses fixed relative filenames (`front.gbr`,
`drill.drl`, `outline.gbr`), and includes metric output, `nog81`, `nom6`, `nog91-1`,
`nog64`, and work-coordinate tool-change heights. pcb2gcode autolevel is disabled;
the application's existing measured-surface compensation handles that separately.

## Operations and retained artifacts

Each output becomes a nominal operation with tool, depth, feed, RPM, and G-code.
Drilling is split at pcb2gcode's tool sections into a separate job per bit size.
Each job establishes G21/G90/G17/G54. Generated tool-selection words and M0 tool
change pauses are removed from these separate jobs: mount the stated tool and
set/probe Z before explicitly loading/running the operation. Drilling retains
each size from the source; it does not force all holes to use one bit.

**Save G-code** exports the selected operation. **Save millproject** exports the
engine configuration. **Save CAM bundle** exports source contents (including
canonical filenames), settings, engine version, configuration, stdout/stderr,
raw engine outputs, and adapted operations as JSON. To reproduce the raw CAM,
extract the sources under their canonical filenames and run pcb2gcode with the
saved millproject. Raw drill output still contains the upstream tool sections;
the adapted operations are the files intended for the application's Job Runner.

Configure startup defaults through the header’s **Settings → PCB CAM** tab.
Saved defaults persist in browser storage and take effect on the next page load.
CAM setup edits, imported sources and results remain in the
shared CAM store for the current page session, including when moving or closing
and restoring the widget. Editing a source or setting marks previous results as
older generation results. Full project save/load and lifecycle tracking belong
to Phase 6; CAM bundle import and back-side/flip alignment are not implemented.

Switching the viewer's operation invalidates Job Runner's loaded-job indicator.
The new operation must be loaded into the sender before Start is enabled. Viewer operation
switching is blocked during running/paused jobs. Existing probe data is retained;
reuse it only when the physical board and work reference still match.

Autolevel compensation retains the original loaded operation separately from its
compensated version. Reapplying always recomputes from that original, including
after surface edits, so offsets do not accumulate. **Revert compensation** restores
the exact original text and geometry; applying or reverting also requires reloading
the displayed job into Job Runner. Loading another file or loading another CAM
operation establishes a new original and clears the previous compensation.

## Cut-width preview (swath)

The viewer's **Cut width (actual size)** layer draws the swept cut area of every
path with a known effective cutting width, at its actual cutting Z. Widths come
from the operation's CAM settings (isolation/outline diameter), the drill bit
size embedded in pcb2gcode's output, or the per-groove `estimated width`
comments in Tool Test G-code — so V-bit test grooves show different widths at
different depths on the same board. While the layer is on, centre lines become
dashed. Paths without a known width (arbitrary G-code files) keep plain solid
centre lines only.

Width is treated as constant per path: pcb2gcode emits 2D centreline geometry
at one fixed depth per operation, so for V-bits the diameter you enter (or the
profile you pick from Tool Test) is the effective width *at that depth*. Within
a single path the width does not vary with Z. Surface compensation shifts the
swath in Z along with the path; it does not change the width or XY position,
because compensation corrects depth, not lateral geometry.

## Backend interface and limits

- `GET /api/cam/status`: availability, version, and diagnostics.
- `POST /api/cam/generate`: `{ files: { front?, drill?, outline? }, settings }`.
  Each source is `{ name, content }`; settings use `common`, `isolation`,
  `drilling`, and `outline` sections.

Both routes sit behind CNCjs's existing API authentication. The frontend reuses
the current token or obtains one through the existing sign-in endpoint without
opening a serial connection. The service has no controller/sender dependency.
It validates structured inputs, uses canonical filenames, and invokes `execFile`
without a shell. Each request uses an isolated temporary directory, removed on
success or failure. Limits: 5 MB per source, 15 MB total source contents, one CAM
generation at a time, 120-second process timeout, 1 MB process logs, and 20 MB per
output G-code file. Invalid/empty generated operations fail with diagnostics.

## Validation

```sh
cd cncjs
./node_modules/.bin/jest src/server/cam/__tests__ --runInBand --coverage=false
cd ../frontend
node --test test/*.test.mjs test/patterns/*.test.mjs
npm run build
```

The CAM tests include an actual pcb2gcode run when the engine is installed, using
authored small Gerber/Excellon fixtures with two drill sizes and outline tabs.
Parser tests cover pcb2gcode's zero-padded G00/G01 notation. HTTP smoke validation
uses a separate backend with an empty controller configuration and verifies
authenticated generation, rejection of unauthenticated/invalid requests, and
parsing all generated operations. No physical machining is part of these tests.
