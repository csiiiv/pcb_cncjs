Build or substantially improve the application's **PCB autolevel / surface probing component**.

# Implementation Status

> Reviewed 2026-11-17. The subsystem lives in `frontend/src/probe/` plus the
> Autolevel widget; backend support is in the `cncjs/` fork's `GrblController`.

The modified backend is pinned by the `cncjs/` submodule; initialize it with
`git submodule update --init --recursive`. See [development setup](development.md).
Measured vertices are
held in memory; save a heightmap before reloading. A saved workflow checklist
does not restore the surface or verify that its physical reference is current.

What exists today:

```text
Section                          Implemented as
─────────────────────────────────────────────────────────────────────────
Coordinate system (work coords)  probe results converted server-side, stored
                                 on mesh vertices in work coordinates
Initial probe mesh (§3)          probe/lattice.js — staggered triangular
                                 lattice, mandatory corners, clamped edges
Vertices authoritative (§4)      probe/store.js — vertices persist; triangles
                                 derived and rebuilt on every edit
Delaunay triangulation (§5)      probe/mesh.js — delaunator
Interactive mesh editor (§6)     Autolevel modal docks over the sidebar; the
                                 3D view stays visible while editing
Adaptive refinement (§7–9)       probe/refine.js — modular candidate engine
                                 (centroid / longest-edge / circumcenter with
                                 auto strategy + min-spacing rejection)
Manual placement                 Add Free Point (exact crosshair XY) and Add
                                 Centroid Point (engine candidate) modes;
                                 typed X/Y entry; per-point removal
Probe execution (§10)            autolevel:start points mode (≤ 2000 pts);
                                 confirmation shows travel + tour length;
                                 travel-optimized order (probe/tour.js:
                                 nearest-neighbor + 2-opt vs serpentine vs
                                 exact ≤ 12); progress + cancel
Probe data model (§11)           z + valid live on vertices; heightmap
                                 save/load/compare (probe/heightmapFile.js)
Probe repeatability              Repeatability test modal (burst/cycled),
                                 per-spot + pooled σ, drift, grading
                                 (probe/repeatability.js)
Linear surface (§12)             probe/surface.js — barycentric getZ over
                                 fully-measured triangles; null outside
Surface visualization (§13)      tinted mesh over toolpath, colormaps, Z
                                 labels, travel path, layer checklist
Compensation (§14)               probe/compensate.js — cutting moves
                                 subdivided (~2 mm), rapids untouched,
                                 outside-hull points REJECTED (no
                                 extrapolation); apply/revert keeps the
                                 nominal original
Reuse across operations          heightmap files reload into any session's
                                 mesh with measurements intact
```

Still open (the "Desired Advanced Version"):

- smooth/cubic (Clough–Tocher) surface + hybrid linear/cubic evaluation with
  overshoot protection;
- interpolation-disagreement and confidence/uncertainty layers;
- error-driven refinement candidate scoring (surface-aware signals);
- toolpath-aware refinement weighting;
- post-probe automatic refinement recommendations / auto-refine.

The numbered sections below are the original design brief, unchanged.

Work from the existing codebase and reuse its current machine-control, visualization, state-management, G-code, and UI architecture wherever practical. Do not redesign unrelated parts of the application merely to match assumptions in this prompt.

The goal is to create an autolevel system optimized for **PCB isolation milling**, where very small changes in PCB surface height can materially affect cutting depth.

# Core Concept

Treat autolevelling as the measurement and reconstruction of a physical PCB surface.

The workflow should conceptually be:

```text
Define machining area
        ↓
Create initial probe mesh
        ↓
Inspect / refine mesh
        ↓
Physically probe mesh vertices
        ↓
Construct measured surface model
        ↓
Evaluate surface confidence
        ↓
Optionally refine uncertain regions
        ↓
Apply Z compensation to machining paths
```

The operator should interact primarily with a **probe mesh**, rather than thinking in terms of rows and columns of a conventional rectangular probe grid.

The central design principle is:

> Start with a coarse model of the board, then place additional physical measurements only where they provide useful additional information.

---

# Coordinate System

All autolevel geometry must be based on the machine's **current work coordinate system**.

The machine may have no homing switches and therefore no useful repeatable machine-coordinate origin.

The PCB coordinate system should normally behave like:

```text
PCB origin = work X0 Y0
PCB surface reference = work Z0
```

Machine coordinates may still be used internally where required by the CNC controller or probe-report protocol, but they must not become the geometric reference for:

- probe points;
- probe mesh;
- PCB boundaries;
- surface models;
- compensated machining paths.

All stored surface geometry should ultimately be expressed consistently in work coordinates.

---

# Initial Probe Mesh

Allow the operator to define or infer the PCB / compensated machining bounds and generate an initial coarse **triangular sampling pattern**.

Prefer approximately uniform, isotropic triangular spacing rather than treating a rectangular grid as the fundamental representation.

A regular triangular / staggered lattice is a reasonable initial generator.

Conceptually:

```text
•──────•──────•
 \    / \    /
  \  /   \  /
   •──────•──────•
  / \    / \    /
 /   \  /   \  /
•──────•──────•
```

The operator should be able to specify a general starting resolution, spacing, or probe-density preset.

The initial point distribution should cover the complete machining region, including boundaries and corners.

Avoid relying on extrapolation outside the measured probe area.

---

# Probe Vertices Are Authoritative

Treat the set of probe vertices as the authoritative geometric representation.

Conceptually:

```text
probeVertices[]
```

Each vertex should at minimum contain XY position and eventually its measured Z value.

The triangulation itself is derived.

Whenever vertices are:

- added;
- removed;
- moved;
- refined;

recompute the triangulation as appropriate.

Do not permanently encode the system around a fixed grid topology.

This enables:

- arbitrary probe placement;
- local refinement;
- irregular sampling;
- progressive measurement;
- future automatic refinement.

---

# Delaunay Triangulation

Use **Delaunay triangulation**, or an equivalent robust scattered-point triangulation method, as the primary spatial representation.

Conceptually:

```text
Probe vertices
      ↓
Delaunay triangulation
      ↓
Surface triangles
```

This triangulation should support both:

1. conservative linear interpolation;
2. future smooth/higher-order surface reconstruction.

It should also provide the spatial framework for deciding where additional probes are useful.

---

# Interactive Probe Mesh

The probe mesh should be visible over the PCB/toolpath visualization.

Useful layers include:

```text
PCB / machining bounds
Machining toolpaths
Probe vertices
Triangular probe mesh
Measured Z values
Surface model
Current probe position
Confidence / uncertainty
```

Relevant layers should be toggleable.

The mesh should be interactive enough that refining part of the PCB feels similar to locally subdividing geometry in CAD or 3D software.

A typical interaction should be:

```text
Select triangle or region
        ↓
Refine
        ↓
New probe location(s) generated
        ↓
Retriangulate
```

The user should not normally need to calculate XY coordinates manually.

---

# Adaptive Mesh Refinement

Local refinement is a core feature.

Do not treat refinement as merely:

> Add the centroid of every selected triangle.

Centroid insertion is an acceptable fallback, but the refinement system should be architected so the strategy can improve independently of the UI.

Conceptually:

```text
refineTriangle(triangle, context)
        ↓
candidate probe location(s)
```

or an equivalent abstraction suited to the current codebase.

The user-facing action may simply remain:

```text
[Refine]
```

while the system decides where another physical measurement is most useful.

---

# Refinement Before Probing

Before any Z measurements exist, refinement must use geometry and machining context.

Useful criteria include:

- triangle area;
- maximum edge length;
- minimum angle;
- aspect ratio;
- distance from existing probe points;
- proximity to machining paths;
- local toolpath density;
- boundaries and constrained areas.

Several refinement strategies should be considered.

---

# Longest-Edge Refinement

For large or elongated triangles, inserting near the midpoint of the longest edge can reduce the largest unsupported measurement span.

Example:

```text
A────────────────B
 \              /
  \            /
   \          /
    \        /
     \      /
        C
```

If `AB` is the longest edge, a candidate near its midpoint can improve sampling density efficiently.

This may be preferable to a centroid for elongated triangles.

---

# Circumcenter / Delaunay Refinement

For poorly shaped or sparsely supported triangles, consider a probe near the triangle circumcenter.

```text
        A
       / \
      /   \
     /  ○  \
    /       \
   B─────────C

○ = circumcenter candidate
```

Circumcenter insertion is a standard Delaunay-refinement idea because it tends to improve spatial coverage and triangle quality.

However, do not insert circumcenters blindly.

Reject or adjust candidates that:

- lie outside the valid PCB / probing boundary;
- lie too close to an existing probe;
- create impractical probe moves;
- add little useful information;
- violate minimum-spacing constraints.

An **off-center** point or another nearby candidate may be preferable.

---

# Centroid Refinement

The centroid remains a useful simple and robust candidate:

```text
        A
        •
       /|\
      / • \
     /  P  \
    •───────•
    B       C
```

where:

```text
P = (A + B + C) / 3
```

This adds a single additional probe and divides the local region spatially.

Use it when it provides a sensible new sample location or as a fallback when more advanced selection is unnecessary.

---

# Full Local Subdivision

When the user deliberately asks for substantially higher resolution over a region, support multi-point refinement.

For example, using edge midpoints:

```text
        •
       / \
      /   \
     /     \
    •───────•

        ↓

        •
       / \
      •───•
     / \ / \
    •───•───•
```

One large triangle becomes several smaller regions.

Shared edge vertices must be deduplicated.

This is appropriate when the user wants a whole selected region to move to a finer resolution rather than requesting one additional measurement.

---

# Refinement Levels

Optionally expose an intuitive user-facing concept of local resolution:

```text
Level 0 — coarse
Level 1 — medium
Level 2 — fine
Level 3 — very fine
```

These levels do not need to represent a strict hierarchical triangle tree because Delaunay retriangulation can alter connectivity.

The level is primarily a user-facing measure of desired local sampling resolution.

Repeated refinement should progressively reduce unsupported probe spacing.

---

# Refinement After Probing

Once physical Z measurements exist, mesh geometry alone should no longer determine where additional probes go.

Use the measured surface to determine where additional information is valuable.

Possible signals include:

- high local Z variation;
- high surface gradient;
- rapid changes in gradient;
- disagreement between neighboring triangle slopes;
- interpolation residuals;
- suspicious probe readings;
- large unsupported triangle area;
- poor mesh quality;
- low measurement confidence;
- disagreement between independent surface models.

The objective becomes:

> Add the next physical measurement where it reduces uncertainty about the actual machining surface the most.

---

# Surface Reconstruction — Conservative Baseline

Implement a conservative baseline surface using:

**Delaunay triangulation + planar / barycentric interpolation.**

For a machining point `(x,y)`:

```text
Find containing Delaunay triangle
        ↓
Use triangle's three measured vertices
        ↓
Barycentric interpolation
        ↓
surface Z(x,y)
```

This should be considered the trusted reference surface because it is:

- local;
- deterministic;
- easy to inspect;
- naturally compatible with irregular sampling;
- compatible with adaptive refinement;
- resistant to interpolation overshoot.

Expose the surface through a clean abstraction such as:

```text
getSurfaceZ(x, y)
```

or whatever equivalent fits the existing architecture.

Downstream compensation should not need to know how the interpolation was implemented.

---

# Smooth / Cubic Surface Model

Design the surface architecture so a smoother interpolation model can coexist with the linear Delaunay model.

A suitable advanced approach is a Delaunay-based smooth piecewise cubic method such as **Clough–Tocher interpolation**, or an equivalent scattered-data cubic method appropriate to the existing language and available libraries.

Conceptually:

```text
same probe measurements
        ↓
Delaunay topology
        ↓
Smooth piecewise-cubic surface
```

The same physical probe measurements must support both:

```text
Linear Delaunay surface
Smooth cubic surface
```

Changing interpolation method must not require another physical probe pass.

Avoid global polynomial fitting over the entire PCB as the primary strategy.

---

# Hybrid Linear / Cubic Evaluation

The desired long-term model is potentially hybrid rather than choosing one interpolation method globally.

Conceptually:

```text
same probe measurements
        ↓
        ├───────────────┐
        ↓               ↓
Linear estimate      Cubic estimate
        │               │
        └───────┬───────┘
                ↓
       Local sanity checks
                ↓
       Trusted surface Z
```

The linear model acts as the conservative reference.

Use the smooth model only where it behaves plausibly.

Potential checks include:

- difference between cubic and linear predictions;
- range of nearby measured Z values;
- probe density;
- triangle size;
- measurement repeatability;
- local residuals;
- distance to nearest physical measurements;
- interpolation overshoot.

If the smooth surface behaves suspiciously, fall back locally to linear interpolation.

Do not force cubic interpolation everywhere merely because it appears smoother.

---

# Overshoot Protection

Higher-order interpolation may create Z values that were not supported by the physical measurements.

For a local region, inspect nearby measured values:

```text
localMeasuredMin
localMeasuredMax
```

If a cubic prediction lies implausibly beyond the surrounding measurement envelope, either:

- fall back to linear interpolation;
- flag the region as uncertain;
- request another probe;
- or apply a conservative bounded policy.

Do not silently trust large cubic overshoots.

---

# Interpolation Disagreement as Uncertainty

Treat disagreement between independent surface estimates as useful information.

Example:

```text
Linear prediction: +0.034 mm
Cubic prediction:  +0.036 mm

Difference:         0.002 mm

→ likely sufficiently resolved
```

versus:

```text
Linear prediction: +0.034 mm
Cubic prediction:  +0.061 mm

Difference:         0.027 mm

→ local surface insufficiently constrained
```

When disagreement is significant, do not simply choose whichever value looks smoother.

Prefer:

```text
More uncertainty
      ↓
Additional physical measurement
```

This disagreement can become one of the most important adaptive-refinement signals.

---

# Error-Driven Probe Placement

Once measurements exist, select new probe locations based on expected information gain.

Candidate points may include:

- triangle centroid;
- longest-edge midpoint;
- circumcenter;
- an off-center Delaunay refinement point;
- point of maximum estimated surface uncertainty;
- point of maximum linear/cubic disagreement;
- a location where important machining paths pass through a poorly constrained region.

Conceptually:

```text
triangle / local region
        ↓
generate candidate points
        ↓
score candidates
        ↓
choose most useful new probe
```

The exact algorithm may evolve, so candidate generation and scoring should remain modular.

---

# Refinement Candidate Scoring

Possible scoring factors include:

```text
mesh coverage
+
triangle quality
+
surface uncertainty
+
surface variation / curvature
+
interpolation disagreement
+
distance from existing probes
+
toolpath relevance
+
probe reliability
```

Conceptually:

```text
priority =
    geometryNeed
  + surfaceNeed
  + interpolationDisagreement
  + machiningImportance
```

The exact formula and weights should remain tunable and should not be scattered through unrelated UI code.

---

# Toolpath-Aware Refinement

Not every portion of the PCB matters equally.

Surface accuracy matters most where shallow cutting will actually happen.

Use machining geometry as an optional weighting factor.

Useful metrics may include:

- total cutting-path length inside a triangle;
- number of path segments crossing a triangle;
- proximity to dense/fine-pitch isolation geometry;
- operation type;
- nominal cutting depth.

Example:

```text
Large triangle
+
no compensated machining nearby
        ↓
lower refinement priority
```

versus:

```text
Moderate triangle
+
dense fine-pitch isolation paths
        ↓
higher refinement priority
```

Toolpath relevance should influence probing effort without replacing geometric/surface-quality criteria entirely.

---

# Manual and Automatic Refinement

Manual and automatic refinement should eventually use the same underlying engine.

Manual:

```text
User selects triangle
        ↓
Refine
```

Automatic:

```text
System identifies uncertain triangle
        ↓
Recommend refinement
```

Both should lead through the same probe-candidate and triangulation logic.

Possible future actions:

```text
[Refine Selected]
[Refine Recommended]
[Auto Refine]
```

Do not require fully automatic probing in the first implementation.

---

# Refinement Before and After Probe Execution

Support both cases.

## Before probing

The operator can visually refine known important areas.

Example:

```text
Fine-pitch IC footprint
        ↓
locally refine mesh
        ↓
probe all resulting points
```

## After probing

The operator or software can detect uncertain regions.

Example:

```text
Initial coarse probe
        ↓
surface analysis
        ↓
triangle flagged
        ↓
refine triangle
        ↓
probe only newly added vertices
        ↓
retriangulate
```

Existing valid probe measurements must be preserved.

Do not unnecessarily reprobe the entire PCB.

---

# Probe Data Model

Keep raw measurements separate from derived models.

Conceptually:

```text
probeVertices
    +
probeMeasurements
        ↓
filtered / validated probe set
        ↓
Delaunay topology
        ↓
surface models
```

Each measurement may retain useful metadata such as:

```text
x
y
z
valid
attemptCount
timestamp
probe sequence
diagnostic flags
```

if appropriate to the existing codebase.

Never destructively convert the raw measurements into a regular grid.

The same raw probe data should remain usable for future interpolation algorithms.

---

# Probe Validation

Treat probe values as physical sensor readings that may occasionally be wrong.

Design for:

- failed contact;
- probe timeout;
- inconsistent readings;
- electrical contact problems;
- isolated outliers.

Where practical, compare a measurement against surrounding surface information.

Example:

```text
Predicted nearby Z: +0.042 mm
Measured Z:         +0.044 mm

→ plausible
```

versus:

```text
Predicted nearby Z: +0.042 mm
Measured Z:         +0.137 mm

→ suspicious
```

Suspicious points may be:

- automatically re-probed;
- marked invalid;
- shown to the operator;
- excluded from surface reconstruction until resolved.

Do not allow a single obviously erroneous measurement to silently distort the compensation surface.

---

# Probe Repeatability

If practical, support collecting probe repeatability statistics.

Repeated measurements at the same XY can reveal:

- standard deviation;
- spread;
- min/max;
- controller/probe repeatability.

These statistics can later help define:

- outlier thresholds;
- confidence tolerances;
- cubic-vs-linear disagreement thresholds.

Do not hard-code excessively precise tolerances without regard to actual machine/probe repeatability.

---

# Surface Confidence

Allow the system to eventually derive a local confidence or uncertainty value.

Potential confidence inputs include:

- probe density;
- triangle size;
- mesh quality;
- local Z residuals;
- probe repeatability;
- linear/cubic disagreement;
- distance from physical samples.

This can support a visual confidence layer such as:

```text
high confidence
medium confidence
low confidence
```

The user should be able to identify where the measured surface is poorly constrained.

---

# Surface Visualization

After probing, visualize the measured surface in a useful way.

Potential layers:

```text
Probe vertices
Measured Z labels
Triangular mesh
Linear surface
Smooth surface
Surface height
Confidence
Interpolation disagreement
```

Useful statistics may include:

```text
Minimum measured Z
Maximum measured Z
Surface range
Probe count
Invalid probes
Uncertain triangles
```

Avoid making visualization mandatory for compensation logic; it should remain a presentation layer over the same underlying surface model.

---

# Compensation

The measured surface should produce a Z offset as a function of XY.

Conceptually:

```text
finalZ(x,y)
    =
nominalMachiningZ
    +
surfaceOffset(x,y)
```

Normalize consistently relative to the selected PCB/work-Z reference.

Keep separate:

```text
nominal machining geometry
raw probe measurements
surface model
compensated machining geometry
```

Do not destructively overwrite the original machining geometry.

---

# Toolpath Subdivision

Do not compensate only the original G-code endpoints.

A long move may cross substantial surface variation.

Example:

```text
Original:

A────────────────────────B
```

must be capable of becoming:

```text
A──•──•──•──•──•──•──•──B
```

with Z compensation evaluated along the path.

Use existing segment-subdivision functionality if the codebase already provides it.

Otherwise implement a sensible maximum compensated segment length or adaptive subdivision mechanism.

The subdivision policy should eventually be informed by:

- surface variation;
- desired accuracy;
- path length.

---

# Coverage and Extrapolation

Avoid silent extrapolation.

The complete compensated machining geometry should lie inside the valid measured / triangulated surface.

If a cutting segment falls outside the probe hull:

- show it clearly;
- prevent unsafe compensation;
- allow the operator to expand/refine the probe region.

Do not silently invent surface height beyond supported measurements.

---

# Probe Path Execution

Physical probing should be treated separately from mesh editing.

Editing the mesh must never immediately move the CNC.

Provide an explicit transition such as:

```text
Probe Mesh Ready

Points: 48
Already measured: 31
New points: 17

[Start Probing New Points]
```

Probe execution must use safe Z motion between points.

It should support:

- progress;
- cancellation;
- probe failure handling;
- existing-point reuse;
- probing only newly added points after refinement.

---

# Probe Traversal Optimization

Probe order may eventually be optimized to reduce unnecessary travel.

The primary goal is correctness and safety.

Once that is reliable, consider path ordering that reduces XY travel while respecting:

- safe Z;
- probe state;
- physical boundaries.

Do not make path optimization more important than predictable machine behavior.

---

# Reuse of Measured Surface

The measured PCB surface should belong to the mounted PCB/job context rather than only one G-code operation.

Once measured, the surface should be reusable for:

- isolation milling;
- other operations needing local surface compensation;
- selective re-machining;
- rerunning individual paths or segments.

Do not require a new full probe pass simply because a different machining path is selected.

A new probe may be required if the physical PCB or coordinate reference changes.

---

# UI Mental Model

Optimize the feature around:

```text
PCB area
Probe vertices
Probe triangles
Surface
Resolution
Confidence
Refinement
```

Avoid forcing the operator to think primarily about:

```text
rows
columns
rectangular matrices
manual XY coordinate entry
machine coordinate offsets
```

A selected triangle could eventually show information such as:

```text
Triangle 42

Max edge:             10.8 mm
Area:                 39 mm²
Measured Z range:      0.014 mm
Surface confidence:    Medium
Toolpath density:      High

[Refine]
```

The user should not normally need to choose between:

```text
centroid
circumcenter
longest-edge midpoint
```

These are refinement-engine strategies.

Advanced/debug tools may expose them if useful.

---

# Safety

This component controls real machine motion and ultimately modifies machining Z.

Preserve existing machine-safety conventions and introduce appropriate safeguards.

At minimum:

- distinguish editing from live probing;
- require explicit operator action before probe motion;
- preview probe locations before execution;
- use safe Z between probe points;
- allow cancellation;
- surface failed probes;
- validate the completed surface;
- identify areas outside probe coverage;
- do not execute compensated machining from an invalid surface;
- preserve original nominal geometry;
- require explicit action before applying/running compensated machining.

Prefer predictable behavior over mathematically sophisticated behavior when the two conflict.

---

# Implementation Approach

Inspect the existing implementation before changing architecture.

Reuse existing:

- CNC/controller abstractions;
- probe commands;
- work-coordinate handling;
- visualization infrastructure;
- application state;
- G-code parser;
- compensation/subdivision logic;

where they already solve the problem well.

Choose triangulation, interpolation, state-management, and rendering libraries that fit the existing codebase.

Do not introduce unnecessary rewrites merely to match this prompt.

Keep major concepts modular:

```text
ProbePointSet
Triangulation
RefinementStrategy
ProbeExecutor
ProbeValidator
SurfaceModel
SurfaceConfidence
Compensation
```

These do not need to be literal class names; preserve the conceptual separation.

---

# Suggested Incremental Implementation

A sensible implementation sequence is:

```text
1. Probe/machining area definition

2. Initial triangular point generator

3. Delaunay triangulation

4. Interactive mesh display

5. Manual triangle refinement

6. Modular refinement strategy API

7. Physical probe execution

8. Raw measurement persistence

9. Probe validation / failed-point handling

10. Delaunay linear surface interpolation

11. Surface visualization

12. G-code Z compensation

13. Local probe refinement after measurements

14. Geometric refinement improvements
    - longest edge
    - circumcenter / off-center
    - full local subdivision

15. Smooth cubic surface model

16. Linear-vs-cubic comparison

17. Confidence / uncertainty estimation

18. Measurement-driven refinement

19. Toolpath-aware refinement weighting

20. Optional automatic adaptive probing
```

Adjust the sequence if the existing codebase makes another order more practical.

Do not block an otherwise useful first implementation on advanced adaptive features.

---

# Minimum Useful Version

The first useful version should already support:

1. defining the compensated PCB area;
2. generating a coarse triangular probe layout;
3. Delaunay triangulation;
4. viewing probe triangles over machining geometry;
5. selecting a triangle and refining it;
6. preserving arbitrary irregular probe points;
7. probing those points in work coordinates;
8. storing raw Z measurements;
9. constructing a linear Delaunay surface;
10. applying that surface to machining Z compensation.

The initial refinement strategy may be simple, but its implementation should not prevent later quality/error-driven algorithms.

---

# Desired Advanced Version

The mature system should be capable of:

```text
Coarse initial probe mesh
        ↓
Probe
        ↓
Delaunay surface reconstruction
        ↓
Linear + smooth surface estimation
        ↓
Surface confidence / disagreement analysis
        ↓
Identify poorly constrained regions
        ↓
Choose useful additional probe locations
        ↓
Probe only new points
        ↓
Retriangulate
        ↓
Repeat until sufficiently resolved
        ↓
Compensate machining
```

Manual control must remain available even after automatic recommendations are implemented.

---

# Success Criteria

The completed component should allow an operator to:

1. define the PCB machining/probing area;
2. create a sensible coarse triangular probe mesh;
3. inspect the mesh over the actual machining geometry;
4. locally increase resolution by selecting regions;
5. use refinement algorithms that can evolve beyond simple centroid subdivision;
6. physically probe the resulting vertices using work coordinates;
7. preserve all valid measurements during later refinement;
8. reconstruct a reliable surface from irregularly spaced measurements;
9. visualize measured surface quality and coverage;
10. compensate machining Z against that measured surface;
11. identify regions where additional measurements would improve confidence;
12. add and probe only those additional points;
13. reuse the same measured surface for later machining or selective repair;
14. remain architecturally open to hybrid linear/cubic interpolation and automatic adaptive refinement.

The primary design principle is:

> **The probe mesh is not merely a predefined sampling grid. It is a progressively refinable measurement model of the physical PCB. Every additional probe should ideally be placed where it improves confidence in the machining surface, while the conservative Delaunay-linear model remains available as the trusted baseline.**
