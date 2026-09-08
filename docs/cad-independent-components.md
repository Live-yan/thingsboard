# Editable CAD components and optional grouping

Default import mode is now **components**, not a single merged static background.
One top-level CAD instance becomes one SCADA widget. A BLOCK definition shared by
two INSERTs still produces two independently editable widgets; primitives nested
inside an INSERT stay with that instance. Source LINEs are not guessed to be pumps.

## Workflow

Hold the left mouse button and drag to select, then choose **Group as one SCADA**.
Grouping does not open the widget-mapping chooser. Select a group to select all its
members; ungroup in the CAD dialog to restore independent components. A raw group
contains the original geometry with original relative positions. Individual
instances and groups can optionally be mapped; clearing a group's mapping retains
its grouping and original vectors. New grouping clears prior member mappings.
Saved mapping schemes no longer apply automatically on upload. The explicit Apply
button only considers ungrouped/unmapped instances and leaves manual work intact.

Click **Import without further mapping** to generate the dashboard directly from
the preview, or use the optional mapping step. A visible estimated widget count
updates as grouping changes. Background merging is available ONLY through the
explicit performance-mode checkbox; a large drawing is never silently collapsed.

Widgets use the existing `settings.scadaSymbolContent` rather than uploading one
image resource per component. This removes those per-component HTTP POSTs and
resource-name conflicts. Each widget's vector content, `cadEntityIds`, `cadGroupId`
and the scene's edit snapshot survive normal dashboard JSON save/export. These
are inline SCADA widgets, **not** automatic additions to the tenant symbol library.
Existing URL-based SCADA resources and non-CAD widgets are not migrated or changed.

## Geometry and interaction contracts

* The resource viewBox is padded to its widget's cell-aligned placement envelope.
  Merely enlarging a tiny widget and stretching the original SVG would distort it;
  actual source geometry is not rescaled inside the padded envelope.
* Component backgrounds are transparent. The layout uses the source canvas color,
  so true-white geometry stays visible without an opaque rectangle hiding another
  component's crossing pipe. Each group owns only its selected member geometry.
* Active gestures attach document listeners outside Angular's idle change detection
  and remove them on release, window blur or destroy. Releasing outside the canvas
  ends the gesture. The drag threshold is 4 CSS pixels, independent of CAD units.
* SVG preparation and widget creation both yield in bounded batches. Small SVGs no
  longer wait for an unconditional timer on the first base64 chunk. Cancelled
  preparation never commits a partial result. The existing dashboard frame-batch
  insertion is retained.
* Font-only substitution notices are deduplicated, remain visible and are saved,
  but do not require missing-content acknowledgement: glyphs are already paths.
  IMAGE/XREF/BIGFONT/PAPERSPACE and other content-loss warnings still require it.

## Validation and scope

Production planner/SVG/grouping functions run in Chromium, including separate
output by default, raw groups without mappings, optional mapping, JSON roundtrip,
transparent crossing geometry, deletion, cancellation, font-warning gating and
1,200-component event-loop responsiveness. Original background-mode tests now
explicitly request that mode; they are not deleted or weakened. Full Angular
application/template compilation is a separate required CI job.

The backend real-DWG regression in the companion PR uses the committed testfile
with a test-only LibreDWG decoder, retaining its decoder warnings; production ODA
is not replaced. This frontend's browser tests are not a deployed ThingsBoard
HTTP/DB E2E test. Thousands of independent Angular widgets still have a rendering
cost. Related objects may be explicitly grouped or exported as a background.
A grouped widget is one editor object after import; changing its member grouping
requires the CAD import editor/source, not a new dashboard ungroup command.

Backend `timings` and `cacheHit` are optional: this UI PR is independently
mergeable. With the backend PR, expand Conversion stage timings to distinguish
server staging, Python/ODA time, DXF parsing and resource reading. Reimport the
source to create separated widgets; previously flattened resources cannot be
magically split by a UI update alone.
