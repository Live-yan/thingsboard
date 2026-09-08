# CAD fidelity contract and regression evidence

Base: `eda192bb59847f80ffb0db5ff51b6e324a4c8e44` (merged PR #1).

## Why preview/export parity was not enough

Both projections could agree on already-damaged geometry. This change adds
analytic geometry assertions and an independent unmodified ezdxf renderer as a
reference, then passes saved SVG through the production SCADA document-preparation
helper. This is stronger than comparing two uses of our own scene builder, but
is **not** an AutoCAD golden-image comparison or a deployed ThingsBoard E2E test.

## Reproduced defects and fixes

| Stage | Defect | Contract |
| --- | --- | --- |
| DXF recording -> SVG | ezdxf SVG integer stroke widths become zero on very large extents; integer path commands collapse small circles and distort fractional polylines. | Absolute fractional path commands; local instance geometry with separate global placement avoids browser float32 precision loss. Read the actual affine coefficients without subtracting large translated points. |
| Colors/background | Removing the renderer background makes true-white strokes disappear on white dashboards; changing all white paints loses source color semantics. | Preserve actual RGB/opacity and the renderer's default canvas policy together. ACI 7 is resolved by the same original document context. No blanket white-to-black rewrite. |
| Bounds | Stroke extents may exceed geometry-only viewBoxes, clipping thick lines. | Extend instance and canvas bounds by actual emitted stroke widths without renormalizing individual geometry. |
| Grid placement | Fixed 1,000 columns can require more than Gridster's 1,000 item rows for portrait drawings. Stale minColumns overrides imported columns. Independent rounding stretches axes. | A single uniform scale, each dimension <= 1,000, less than one cell of padding, same frame for background resource and layout. Reset minColumns. Desktop SCADA uses square cells; mobile rowHeight is not a desktop aspect-ratio correction. |
| SCADA runtime | Rebuilding from innerHTML drops root presentation/viewport semantics; unconditional preserveAspectRatio=none deforms circles. Regex ID prefix replacement corrupts references. | Clone the real SVG root once, rewrite exact IDs and fragment references, preserve CAD aspect ratio at runtime. Explicit non-CAD stretch behavior remains supported. |
| Missing content | ImagePolicy.IGNORE, unloaded XREF, paper-space-only content and substituted fonts were not actionable in the UI. | Bounded structured warnings pass Python -> Java -> UI; acknowledgement is required and recorded with the import. Populated XREF blocks still render. |
| Pattern hatches | Default timeout returns partial hatching; dense-pattern fallback can substitute a solid fill; collecting all generated lines increases peak memory. | Stream chunks of 1,024 line segments through the bounded recorder. Timeout/density errors fail the conversion rather than return a misleading complete diagram. |

### Explicit display policy

Scene schema is now **v3**. Each asset carries `data-cad-local-entity`, a local
viewBox and global `previewX/Y/Width/Height` in the manifest. The frontend still
understands previous global-coordinate assets. The completed static scene carries
`data-cad-scene`, an opaque background and its global viewBox.

A **0.5 CSS-pixel minimum hairline at a 1200x700 fit view** is applied in SVG units;
source weights above that floor are preserved. Widths scale normally with zoom.
This is a documented on-screen visibility policy, not a promise of exact plot
lineweights or the user's AutoCAD theme. The renderer's default background is
preserved; true white is never silently recolored. Fonts must be supplied and
licensed separately on the converter host for matching glyphs and metrics.

## Regression coverage

`tests/cad/test_fidelity.py` covers large coordinate extents and tiny features,
fractional polylines, analytic circle bbox/circumference, white paint/background,
clipping, external-image/XREF/paper-space diagnostics, missing fonts, hatch chunk
sizes/density/timeout, exact runtime ID references, and saved-resource aspect
preservation at a mismatched widget viewport.

An independent ezdxf SVGBackend renders a fixture containing circles, a rotated
ellipse, bulge polyline, spline, text, a hatch with a hole, mirrored/rotated nested
blocks and a dimension. Chromium compares that image with the saved background
passed through the production runtime document helper. PNGs and the pixel-error
report are retained. The reference shares the ezdxf CAD interpretation, so it
cannot detect limitations common to ezdxf and our implementation.

The geometry-heavy benchmark uses **1,000 nested block instances / 31,000 rendered
primitives**, including curves, hatches, rotation and reflection, without padding
the file with comments. It records source/output bytes and elapsed conversion time.
It complements, rather than replaces, the prior 128 MiB bounded Java stream test
and the comment-heavy 64 MiB DXF input test. Synthetic measurements are not a
production latency SLA; dense real DWG, fonts and ODA behavior require real samples.

Existing conversion/deletion/undo/snapshot/isolation/cancellation regressions stay
in place. Shared browser fixtures move to conftest; no failing tests are skipped.
The CAD CI also compiles the full Angular application and templates. It does not
build the entire Java application or exercise a running database/server.

## Deployment and remaining limits

Deploy the Python scripts and Java/UI changes together (ezdxf **1.4.4**, as pinned
in CI), then **reconvert the source CAD and regenerate the dashboard**. Already
saved SVG paths rounded to zero cannot be repaired just by updating the UI. Keep
previous dashboards until the newly imported result is inspected.

Only modelspace is imported in this route. A paper-space layout picker/viewports,
embedded external raster packaging, unresolved external DWG references, OLE/ACIS
and all unsupported/proxy objects are not implemented by this patch. Warnings
make those boundaries visible, not supported. Bind required XREF content into the
source; do not grant an uploaded drawing arbitrary server filesystem/network
access. Missing source fonts are reported before accepting substituted geometry.

The old `/cad/convert` block-library route is not rewritten. Canonical scene
changes apply to `/cad/convert-per-entity`, its editable preview, retained SCADA
background resources and dashboard generation. Existing bounded upload, output,
primitive/depth/concurrency limits and browser time slicing remain enabled.

Final production acceptance should use the exact failing DWG/DXF, the selected
AutoCAD model/layout, expected reference render, and required authorized fonts or
external dependencies. Check conversion warnings, saved SVG, resource reload and
actual dashboard geometry independently; do not equate a green helper test with
full AutoCAD compatibility.
