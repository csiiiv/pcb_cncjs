# Component defaults

Open **Settings** in the app header. Each dock component has its own tab. Edit
startup values, then choose **Save defaults**. These values persist in this browser
and take effect on the next page load. **Cancel**, Escape or closing the panel
discards unsaved edits. Info icons beside each parameter explain its meaning,
units and relevant constraints. Hover, focus with Tab, or tap an icon to read its
help; Escape dismisses a focused tooltip. **Reset this tab** restores factory values in the draft;
choose Save to retain the reset. Invalid values block saving and show errors.

Defaults include:

- Connection: server URL, preferred serial port, baud rate and opt-in
  **Auto-connect machine on load** (off by default). Blank URL uses the
  frontend's current server/proxy. With auto-connect disabled, use Connect;
  with it enabled, the Debug Connection widget attempts to open the preferred
  port, otherwise the first USB serial port or first available port. This does
  not start a machining job. This attempt runs when that widget is mounted;
  Guided/Tool Testing's compact controls still use an explicit Connect action.
- DRO and Status: decimal precision, machine coordinates and detailed status rows.
- Machine Controls and Spindle: initial jog step, XY/Z jog feeds and RPM.
- PCB CAM: board clearance/origin and isolation, drilling and outline parameters.
- Tool Test: pattern, V-bit geometry, depth sweep, coupon layout/tick depth, feeds
  and spindle speed. Saved calibration profiles are managed in Tool Test and PCB
  CAM independently of startup defaults.
- Toolpath: initial camera view, heightmap palette and layer visibility, including
  the cut-width (swath) overlay that draws the actual swept cut area of paths with
  a known tool or cut width.
- G-code and Console: following selection/execution and console autoscroll.
- Probe: wiring confirmation, axis, G38 command, travel, feed, plate thickness
  and retract. The wiring confirmation shows a safety check (with a live
  probe-circuit lamp) before any probing move; disabling it starts probes
  immediately.
- Autolevel: probe heights/feed, bounds, lattice spacing/margin and repeatability
  attempts/mode. Repeatability motion starts from the current autolevel setup.

Job Runner has no configurable defaults; its tab explains the explicit load/start
workflow. Saving settings does not send machine commands or change mounted
components' current job setups. Per-job controls can be adjusted independently of
saved startup values. CAM sources/results and measured probe data are not defaults.

Existing CAM settings, spindle RPM and viewer preferences are used when there is
no central settings record yet. Once saved, the central defaults take precedence.
Missing or invalid stored sections fall back to factory values. Storage failures
are reported when saving. Layout and modal widths retain their existing storage.

## Collapsing components

In Debug mode, each dock component has a chevron in its title bar. Click it to collapse the
component to its title bar, then click again to expand. Collapsing keeps the
component mounted, preserving its current inputs, generated results and live
subscriptions. The previous expanded height is restored, and collapsed states
persist in this browser across page reloads. Collapsed components remain draggable.
Loading G-code automatically expands Toolpath so the loaded job is visible.
