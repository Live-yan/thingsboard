# Editable CAD instances and optional SCADA grouping

This PR is stacked on #3 (font resolution / server conversion performance).
Merge the parent first, then retarget this PR to master if GitHub has not done
so automatically. It does not merge or rewrite master.

## Interaction contract

The default import mode is `components`: each retained top-level CAD instance
becomes its own SCADA widget, even when no device/widget mapping is selected.
A top-level INSERT remains one instance; this is not automatic explosion of a
shared CAD block definition. Ordinary lines and text remain separate if that is
how the CAD drawing is authored.

Hold the left mouse button and drag to box-select; click to multi-select. Select
at least two instances and choose **Group as SCADA** to make one vector component.
This does not open a widget picker. Selecting any member of an existing group
selects the whole group. Combining it with another selection includes its whole
membership. Ungroup returns members to individual components. Device mapping is
optional and separate; clearing a group's mapping retains the grouping and its
original vector artwork. A mapped component intentionally uses its chosen widget
instead of its original CAD appearance.

Background merging is now explicitly opt-in. Legacy background-mode regressions
remain, but their inputs specify `importMode: background` instead of relying on
the mere presence of preview coordinates to collapse an entire drawing.

## Geometry and persistence

Each independent/grouped asset is transparent. The source canvas color is saved
in the dashboard layout, not as opaque per-component rectangles which would hide
crossing geometry. Minimum editing handles are implemented by expanding the SVG
viewBox to the widget's integer cell boundaries; geometry keeps the same scale
and position, including tiny circles / thin horizontal or vertical lines.

Each generated widget stores its source instance membership in `cadComponent`.
The first widget also stores the versioned source-scoped `cadComponents` snapshot,
including groups and import mode, alongside `cadSceneEdits`. The existing explicit
restore action after reuploading the same file restores grouping and deletions.
Snapshots reject wrong-source, unknown, duplicate or overlapping member IDs before
changing the scene. Restoring grouping does not silently restore device bindings;
those should be reviewed or reapplied from the separate mapping scheme.

Grouping changes the editing unit: overlapping unrelated entities may have a
changed stacking relationship when some of them become one widget. Inspect the
result for drawings that depend on elaborate draw order. This does not add DWG
writing, nested block explosion or arbitrary semantic equipment recognition.

## Validation

The ordinary suite strictly compiles production helpers and runs real Chromium
against individual/grouped outputs, optional mapping, transparent assets, minimum
handle geometry, JSON roundtrip, deletion, cancellation and ungrouping. Existing
background, fidelity, large-file and cache tests remain. Angular compilation
checks production integration and the template separately in Actions.

The real-DWG workflow decodes `files/testfile.dwg` with test-only LibreDWG 0.13.3,
then invokes the production converter and browser planner. Its expected decoded
73 instances become 73 independent components without mapping. Grouping five
instances results in 69 components with all 73 member IDs present exactly once.
`editable-components.json` states which source was tested and records elapsed
time. No ODA/AutoCAD equivalence or deployed database/server E2E is implied.

This PR retains bounded parallel image-resource uploads. A separate performance
PR introduces bounded embedded SVGs to avoid one network upload per small symbol;
keep that optimization independent from editing/grouping semantics.
