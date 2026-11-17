# V-bit tool tests and saved profiles

The **Tool Test** dock component generates test G-code locally. Choose **Trace
coupon with ticks**, **10 mil angle comparison** or **Separate depth grooves**, then set the V-bit’s full
included angle, flat tip diameter, negative depth range and positive increment.
Configure length, spacing, work XY start, clearance, feeds and spindle speed.
Save startup values under **Settings → Tool Test**. Older saved Tool Test
defaults retain their separate-groove mode; choose the coupon to use the new pattern.

## Trace coupon

The default coupon isolates four retained copper traces running along +X:

| Trace | Nominal copper width |
|---|---|
| 5 mil | 0.127 mm |
| 10 mil | 0.254 mm |
| 15 mil | 0.381 mm |
| 20 mil | 0.508 mm |

These traces are ordered from lower to higher Y. The test length is divided into
equal X sections, each cut at one depth from shallow to deep. At each section the
two isolation boundaries of each trace are offset by half the desired copper
width plus half the estimated cutter width at that depth. This keeps nominal
trace widths constant when the estimated cutter geometry matches the actual cut.
Each section is cut once; depths change between sections.

A separate reference groove above the traces follows the same depth steps. Use
it to measure the effective cutting diameter. Tick marks below the traces mark
section boundaries, beginning at the start X. Every fifth tick is longer. The
first section lies between ticks 0 and 1 and uses the shallowest depth; the table
maps each section’s X range to its depth. Ticks use the separate **Tick depth**
setting. Their depth should leave visible marks in the coupon material.

Depth boundaries can produce shoulders and rounded transitions in the isolation
channels. Inspect and measure inside each section, away from those transitions.
Traces are continuous strips in surrounding copper, without cut end caps; this
coupon is for visual/dimensional inspection of isolation and retained width,
not an electrical continuity test between isolated nets.

The default 60° / 0.1 mm tip coupon uses ten depths from −0.02 to −0.20 mm, a
30 mm total length (3 mm per section), and 2 mm trace spacing. Generation checks
that trace lanes and ticks have room for the estimated cutter width. The
reported XY range covers path centres; allow extra room for the cutter width.

## 10 mil angle comparison

This mode lays out six nominal 10 mil (0.254 mm) copper traces. From lower to
higher Y, they assume **15°, 30°, 45°, 60°, 75° and 90° full included angles**.
All rows share the entered tip diameter. The single Included angle field is
unused in this mode. Each trace progresses through the configured depths in
equal X sections, with ticks below the rows marking the section boundaries.

Each pair of boundary paths uses the cutter width calculated for its row’s
assumed angle at that section’s depth. Cut the whole coupon with the same physical
bit, then compare the retained copper inside each section with a known 10 mil
reference. A consistently matching row suggests effective geometry for that tip
assumption; shallow complete clearance remains a separate requirement. Matching
one section alone does not establish the physical angle, tip diameter or Z zero.
There are no separate reference grooves in this mode; the isolation boundaries
are available for inspection or measurement. These strips also have no end caps.

The table identifies each sample by section, angle and row Y. **Choose** fills
the estimated width for that angle/depth; saved profiles retain the chosen row’s
assumed angle. Leave the measured checkbox unchecked when comparing visually.
For the recent test setup, enter **0.2 mm tip diameter** explicitly; the factory
startup value remains 0.1 mm. Row and tick spacing validation uses the widest
hypothesis (90°), and G-code comments record the row order and depth sections.

## Separate depth grooves

This alternative cuts one independent straight groove per depth along +X. Rows
advance along +Y with the configured spacing. The table identifies rows by their
Y coordinate. No tick marks are cut in this mode.

All patterns include the deepest endpoint even when the depth range is not an
exact multiple of the increment. Tests are limited to 50 depth samples, and all
XY rapid moves follow a retract to safe Z.

## Width calculation and running a test

For included angle A, flat tip diameter t and depth magnitude d:

```text
estimated groove width = t + 2 × d × tan(A / 2)
```

A 60° bit with a 0.1 mm tip has an estimated width of 0.215 mm at −0.10 mm.
Runout, tip geometry and material surface height affect the actual cut. Inspect
for complete copper removal and measure the reference groove at the chosen depth.

Set work XY0 for the coupon and work Z0 on its surface. The program establishes
G21/G90/G17/G54/G94, retracts to safe Z, starts the spindle with the configured
spin-up wait, cuts the pattern, retracts, then stops the spindle and ends. It does
not set machine/work offsets. **Load G-code** displays it in Toolpath, and
**Save G-code** downloads it. Each groove comment carries its estimated width, so
the viewer's **Cut width (actual size)** layer draws every groove at its own
width — the depth→width relationship of the V-bit is directly visible. Review it,
then explicitly **Load into sender** and
**Start** in Job Runner. Loading is blocked while a job is running or paused.
Measured-surface compensation can be applied through Autolevel when it matches
the test setup.

## Saving and applying a calibration

Choose a depth section/row with satisfactory isolation. **Effective width** starts
with the geometric estimate; replace it with the measured reference-groove width.
Check **Width measured on this coupon** to record that the value was measured.
Enter a profile name and optional material/notes, then **Save tool profile**.
Saving an existing name updates that profile. Profiles persist in this browser,
including after reloading, and retain:

- Bit included angle and tip diameter.
- Selected depth and effective cutting diameter.
- Cutting/plunge feeds and spindle RPM from the generated test.
- Measured/estimated status, material notes and original test settings/section.

Select a profile in PCB CAM (dock or Isolation setup step) and **Apply to CAM
isolation**. This sets `depth`, `diameter`, `feed`, `plunge` and `rpm`, increasing
isolation width if necessary to accommodate the diameter. pcb2gcode receives
these through the existing `zwork`, `mill-diameters`, `mill-feed`,
`mill-vertfeed` and `mill-speed` settings. The bit angle/tip describe the
calibration; pcb2gcode uses the calibrated effective diameter at the selected
depth. Generate CAM toolpaths again after applying a profile.

**Use for CAM isolation** applies the chosen current test result without saving a
profile. Applying a profile does not save startup defaults automatically or send
machine commands. The generated table and G-code retain their original test
settings; setup edits mark them as an older generation. Unsaved test results
remain in the widget while mounted; close/reload resets the test, while saved
profiles remain in browser storage.
