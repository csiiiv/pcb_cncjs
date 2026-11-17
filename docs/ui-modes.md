# UI modes and Guided view

Reviewed against the implementation on 2026-11-17. All three header modes
are implemented. See [workflow.md](workflow.md) for the twelve guided stages.

## Choosing a mode

| Mode | Shortcut | Layout and purpose |
| --- | --- | --- |
| Debug | Ctrl/Cmd+1 | Draggable, resizable dock with individually restorable widgets. |
| Guided Milling | Ctrl/Cmd+2 | Stage rail, toolpath/G-code center, compact machine column and step wizard. |
| Tool Testing | Ctrl/Cmd+3 | Calibration selector, toolpath/G-code center, machine controls and test panel. |

A fresh browser starts in Guided Milling. The selected mode is saved under
`pcb-cnc.mode.v1`. A valid `?mode=debug`, `?mode=guided` or `?mode=test`
parameter takes precedence while present in the URL; remove it to let the
saved mode determine the next page load.

Switching modes changes the mounted layout. Machine, CAM, probe, viewer,
runner and workflow stores stay shared for the lifetime of the page.
Widget-local inputs, open dialogs and unsaved Tool Test results may be lost
when their component unmounts. There is currently no mode-switch discard
confirmation; save test G-code or a calibration profile first.

## Debug

Debug exposes the individual Connection, Status, DRO, Machine Controls,
Spindle, PCB CAM, Tool Test, Toolpath, G-code, Probe, Autolevel, Job Runner
and Console widgets. The dock supports drag/drop, resizing, collapsing and
restoring components. Its layout is saved under `pcb-cnc-layout-v1`.

Collapsing a dock component keeps it mounted. Switching modes or closing a
component can unmount it. The compact layout preset replaces the five
machine widgets with a combined MachinePanel; the originals remain available.

The full CAM setup wizard and Autolevel mesh editor remain available here.

## Guided Milling

Choose **New board** to create a session. An existing checklist is loaded
from this browser's storage when available. The left rail lists twelve
stages, their completion state and blocking reasons. A station, the rail's
next action or the global footer's **next** action opens the corresponding
step in a resizable side wizard.

The center shares the existing 3D toolpath viewer and a collapsible G-code
panel. The right column combines connection, position, jog, zero and spindle
controls, plus the Console. The wizard contains dedicated views for:

- Connection, PCB source import and CAM generation.
- Toolpath selection and work XY/Z setup.
- A clearance-height bounds tour before surface probing.
- Surface mesh generation/probing and compensation or explicit skip.
- Operation preview, tool records, sender loading, armed Start and run controls.
- Parking and final inspection.

Operation rows offer raw and compensated previews when both copies exist.
Loading the sender and confirming Start happen inside the Operations step;
the Debug Job Runner remains another way to use the same backend. Changing
the preview or compensation requires the sender to be loaded again.

A machine Alarm displays a recovery overlay. Unlock and re-check zero are
explicit actions. The overlay and checklist are guidance; the operator still
needs to confirm the mounted board, tool and reference before continuing.

## Tool Testing

The left selector offers **V-bit tests**, **Probe repeatability** and
**Heightmap compare**. V-bit tests include the trace coupon, 10 mil angle
comparison and separate depth grooves. The probe-quality entries reuse the
Autolevel widget's Test and Compare dialogs. Repeatability performs probing;
heightmap comparison analyzes saved files.

The center shares the viewer and G-code panel, and the right side contains
MachinePanel and the selected test controls. Saved tool profiles persist
across modes; unsaved generated tests belong to the mounted Tool Test widget.
See [tool_test.md](tool_test.md) for calibration and applying a profile in CAM.

## Layout and persistence

| Record | Current behavior |
| --- | --- |
| `pcb-cnc.mode.v1` | Selected header mode. |
| `pcb-cnc-layout-v1` | Debug dock layout, including collapsed components. |
| `pcb-cnc.guided-prefs.v1` | Guided preferences, including G-code collapse. |
| `pcb-cnc.test-prefs.v1` | Selected Tool Testing entry; its G-code collapse state resets on remount. |
| `pcb-cnc.workflow.v1` | One board's checklist and operation diary, not a complete project. |

Guided and Tool Testing use fixed compositions rather than the Debug dock's
free layout. Shared in-memory stores survive a mode switch, not a page
reload. See [workflow recovery limits](workflow.md#5-session-persistence-and-recovery)
and [settings](settings.md) before relying on saved browser state.

## Implementation map

```text
frontend/src/App.jsx                         header, mode switcher, global dialogs/footer
frontend/src/modes/modeRegistry.js           mode IDs, lazy imports, URL/storage selection
frontend/src/modes/GuidedMode.jsx             guided layout and live gates
frontend/src/modes/ToolTestingMode.jsx        calibration layout
frontend/src/widgets/compact/MachinePanel.jsx  full/lite composite (lite is a prop)
frontend/src/widgets/SubwayRail.jsx           twelve-stage rail
frontend/src/guided/GuidedWizard.jsx          shared step-modal shell
frontend/src/guided/steps/                    dedicated stage views
frontend/src/workflow/session.js             session data and transitions
frontend/src/workflow/reconcile.js           machine/CAM/probe/viewer reconciliation
frontend/src/workflow/guide.js                guide content and suppression preferences
frontend/src/widgets/StepGuideModal.jsx       stage help
frontend/src/workflow.js                     footer next-action computation
```

The footer uses the session stage walk when a session is active and a
heuristic next-action calculation otherwise. Reconciliation is bound once
at App level, so activity in Debug also updates the shared checklist.

## Remaining work

Full project restoration and session archives, a unified cross-mode routing
API, unsaved-result discard prompts, additional calibration types and broader
mode-render coverage remain follow-up work. The frontend test command and
build instructions are in [development.md](development.md).
