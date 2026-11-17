# Guided machining workflow

Reviewed against the frontend on 2026-11-17. The session store, twelve-stage
rail, dedicated step wizard, event reconciler and session-aware footer are
implemented. This document describes current behavior; project archives and
complete restart recovery remain open work.

## Purpose

A board session records the setup and operation sequence. The stage rail
shows progress and the next action without requiring the operator to infer
the order from independent dock widgets. Guided Milling and Debug use the
same machine commands, CAM/probe/viewer stores and CNCjs sender.

The checklist advances from observed activity or explicit operator decisions.
It does not automatically start a job, change a tool or recover a reference.

## 1. Starting and navigating

Select **Guided Milling** and choose **New board**. Select a station or use
**next** in the rail/footer to open its dedicated step wizard. Stage help is
available through the question-mark controls. Debug actions also update the
same session through the app-wide reconciler.

## 2. Canonical stages

The IDs and order below come from `frontend/src/workflow/session.js`.

| Stage | ID | Current action/completion evidence |
| --- | --- | --- |
| 1. Connect | `connected` | CNCjs server and machine port connected; closing the port reopens this stage. |
| 2. Import sources | `imported` | CAM source files imported. |
| 3. Generate | `generated` | CAM result available. |
| 4. Select toolpath | `toolpath` | A generated operation is previewed in the viewer. |
| 5. Mount + Zero XY | `zeroedXY` | Work-coordinate XY zero commands observed. |
| 6. Zero Z | `zeroedZ` | Z zero command observed, including touch-probe plate adjustment. |
| 7. Verify bounds | `verifyBounds` | Bounds-plus-margin tour completed at clearance, or explicitly skipped. |
| 8. Probe surface | `surface` | Measured mesh available, or explicitly skipped. |
| 9. Compensate | `compensated` | Compensated job previewed, or explicitly skipped for nominal cutting. |
| 10. Run operations | `operations` | Run the generated operations with the mounted tool and current Z reference. |
| 11. Park | `park` | Send spindle stop and the selected park program. |
| 12. Finish | `finish` | Inspect and mark the board complete. |

The stage flags are evidence of application actions. They do not prove the
board is still mounted correctly or that a physical reference remains valid.
A zero-command write records that the command was sent, rather than a
measurement of the resulting offset. Surface reconciliation accepts at least
three measured vertices when probing is no longer running; compensation
separately requires coverage of the toolpath.

The verified bounds are tied to the selected operation. Switching to a
different operation reopens verification unless it was explicitly skipped.
Bounds, surface probing and compensation each have an explicit skip action.

## 3. Session data

The session store keeps one record with:

- Session ID, board label, start/update timestamps.
- Stage records with `done` and `at`, plus details such as skip flags,
  verification Z/operation ID, probe count/range and plate thickness.
- Operation ID/name/kind, tool description, depth, compensation flag,
  status, run timestamp and end state.
- Active operation ID and mounted-tool description/timestamp.

Operation statuses are `pending`, `ready`, `running`, `done`, `failed` or
`skipped`. Transitions are checked by the session store. The rail's current
stage is the first stage whose `done` flag is false; operation completion
requires a nonempty list with every operation done or skipped.

CAM results seed the session's operation list. This record contains operation
metadata and outcomes, not the source files or executable G-code. It is an
internal browser record, not a supported project interchange format.

## 4. Running operations and tool changes

In **Run operations**, preview the intended raw or compensated operation.
**Record tool…** records the mounted tool and makes the previous Z-zero
record stale. Re-establish Z after each tool change before starting.

Choose **Load into sender** to send the currently previewed G-code to CNCjs.
The loaded-job check includes its text and machine port. Previewing another
operation, applying/reverting compensation or changing the port requires
reloading the sender. Switching operations during a running/paused job is
blocked.

**Start** arms the action and displays the preflight checklist. Confirm
within six seconds to start. The displayed checks include connection, matching
loaded G-code, tool/Z setup, work-coordinate system and current compensation.
The checklist is advisory: the current Start handler does not enforce every
displayed warning. Review and resolve them before confirming. Pause, Resume,
Stop and Force stop remain explicit controls; force stop uses hold plus
soft reset.

A compensated copy is associated with the current operation. Raw/compensated
preview buttons can switch between its two versions without accumulating
compensation. Previewing another CAM operation may clear the previous
operation's compensated copy. Reapply compensation for the new operation
using a surface that still matches the physical board/reference.

The intended machining order is front isolation, drilling, then outline so
the board remains supported. Drill jobs are separated by tool size. Current
operation rows follow the generated list; there is no operation reordering
UI or selective repair-job generator.

## 5. Session persistence and recovery

The checklist is saved in `localStorage` under `pcb-cnc.workflow.v1` and
loaded when the app starts in the same browser/origin. Saved defaults, tool
profiles, park programs and UI preferences have separate records.

CAM sources/results, loaded viewer G-code, sender-load identity and measured
probe vertices are in-memory application state. A page reload does not
restore them from the checklist. The persisted operation statuses therefore
do not provide automatic job resume or establish that a prior surface and
work reference can be reused.

Before closing or reloading, save the CAM bundle, operation G-code and
heightmap using their export actions. After returning, reconnect and inspect
actual machine state, restore or regenerate the required files, confirm the
mounted tool and work offsets, and reload the intended job explicitly.
CAM bundle import and unified project save/load are not implemented.

**Mark board complete** sets the Finish flag in the current browser record.
The UI calls this “archived,” but there is no separate archive collection or
project file written. Starting a new board/abandoning the current session
clears that current checklist; export artifacts separately first.

## 6. Reconciliation and recovery controls

`workflow/reconcile.js` is bound at App level in every mode. It watches:

- Port state and sender workflow transitions.
- CAM files/results and generated operation IDs.
- Serial writes that establish XY/Z work zero.
- Measured probe vertices and applied/reverted compensation.
- Preview operation identity for selection and bounds invalidation.

Run completion is inferred from the transition out of running/paused and
sender acknowledgement counts. Probe cycles are excluded from operation-run
tracking. Reconciliation emits no machine commands.

On Alarm, Guided shows a recovery overlay with explicit Unlock and Re-check
zero actions. Re-check zero clears the tool record and the Z stage. Confirm
the physical setup before continuing; the persisted diary is not a substitute
for live machine state.

## 7. Implementation and checks

```text
frontend/src/workflow/session.js       session record, validation, transitions
frontend/src/workflow/reconcile.js     observed activity → stage/operation updates
frontend/src/workflow/zeroEvents.js    zero-write recognition
frontend/src/workflow/guide.js         stage help and guide preferences
frontend/src/workflow.js               next-action computation
frontend/src/widgets/SubwayRail.jsx    stage rail and operation status
frontend/src/guided/GuidedWizard.jsx   resizable step wizard
frontend/src/guided/steps/             stage-specific controls
frontend/src/guided/parkPresets.js      built-in/custom park programs
```

Frontend tests include session transitions, stage guidance and compensation
behavior. Run them with the commands in [development.md](development.md).
Software tests do not exercise a physical machining cycle.

## 8. Remaining work

Unified project save/load, reliable restart reconciliation, separate session
archives, back-side alignment, operation reordering and repair micro-jobs
remain future work. See the [project status](project.md#implementation-status)
for the broader roadmap.
