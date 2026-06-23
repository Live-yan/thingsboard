# CAD Import Fidelity Work Order

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CAD import preview and dashboard output preserve the original CAD/SVG visual structure, entity positions, colors, and interaction semantics.

**Architecture:** Establish one authoritative CAD-to-SVG/dashboard transform contract in the backend manifest, then make preview selection, deletion, mapping, and dashboard layout consume that same contract. Avoid independent per-entity normalization for dashboard assets unless an inverse/global transform is preserved.

**Tech Stack:** Python `ezdxf` conversion in `application`, Java CAD service DTO/API in `application`, Angular CAD import dialog and ThingsBoard dashboard/Gridster/SCADA symbol rendering in `ui-ngx`.

---

## Background

The current CAD import path is documented in `SCADA-SYMBOL-GUIDE.md`: dashboard edit button "从CAD导入" calls `/api/cad/convert-per-entity`, backend invokes `dwg_to_svg.py`, returns `preview.svg`, `manifest.json`, per-entity SVGs, and the frontend imports entities into a SCADA layout.

The desired outcome is stricter than "CAD entities show up": the preview should look like AutoCAD or an exported full SVG, entities should keep distinct colors and correct relative positions, real blocks/lines/text should be selectable/deletable/mappable in the preview, and unmapped entities imported directly to the dashboard should reconstruct the original CAD shape.

## Current Blocking Root Causes

- [ ] `application/src/main/data/scripts/cad/dwg_to_svg.py:217` defines `_rewrite_viewbox_to_cad_wcs()` but the per-entity main flow does not use it.
- [ ] `application/src/main/data/scripts/cad/dwg_to_svg.py:748` renders each entity SVG in a separate coordinate space.
- [ ] `application/src/main/data/scripts/cad/dwg_to_svg.py:764` resizes each entity SVG independently for SCADA usage.
- [ ] `application/src/main/data/scripts/cad/dwg_to_svg.py:778` writes manifest bbox in CAD WCS, which no longer matches independently normalized entity SVG content.
- [ ] `application/src/main/data/scripts/cad/dwg_to_svg.py:819` renders preview SVG as another independent output instead of the same geometry contract used by manifest/entity SVGs.
- [ ] `application/src/main/data/scripts/cad/dwg_to_svg.py:821` changes preview colors and stroke widths with string replacements, causing visual drift from AutoCAD/SVG export.
- [ ] `ui-ngx/src/app/modules/home/components/dashboard-page/cad-import-dialog/cad-import-dialog.component.ts:229` infers preview mapping from the SVG string instead of an authoritative backend transform.
- [ ] `ui-ngx/src/app/modules/home/components/dashboard-page/cad-import-dialog/cad-import-dialog.component.ts:277` draws selectable preview entities as bbox rectangles, not the real SVG entity geometry.
- [ ] `ui-ngx/src/app/modules/home/components/dashboard-page/cad-import-dialog/cad-import-dialog.component.ts:484` mapping is tied to list actions; preview click selection and widget mapping are not a single real-entity interaction model.
- [ ] `ui-ngx/src/app/modules/home/components/dashboard-page/cad-import-dialog/cad-import-dialog.component.ts:572` maps entity bboxes to a fixed 1000x1000 grid, independent of actual dashboard row-height/aspect behavior.
- [ ] `ui-ngx/src/app/modules/home/components/dashboard-page/dashboard-page.component.ts:1303` sets SCADA columns but does not set CAD aspect-ratio row sizing.
- [ ] `ui-ngx/src/app/core/services/dashboard-utils.service.ts:697` can apply normal widget layout insertion behavior, including collision handling that may move CAD widgets away from their intended positions.
- [ ] `ui-ngx/src/app/modules/home/components/widget/lib/scada/scada-symbol.models.ts:789` scales each SCADA symbol to fit its own widget container, so separately normalized entity SVGs cannot reconstruct global CAD geometry.

## Recommended Architecture Decision

- [ ] Use one authoritative transform returned by the backend manifest.
- [ ] Make preview SVG, entity metadata, selection overlay, deletion, mapping, and dashboard grid placement consume that same transform.
- [ ] Prefer importing one full global SVG as the static CAD background and putting mapped widgets on top.
- [ ] If continuing with per-entity widgets, generate dashboard entity SVGs in global canvas coordinates or include an inverse/global transform; do not use independently padded/normalized entity SVGs for final dashboard reconstruction.
- [ ] Keep normalized entity SVGs only for thumbnails if needed.

## Files To Inspect Or Modify

- [ ] `SCADA-SYMBOL-GUIDE.md`
- [ ] `application/src/main/data/scripts/cad/dwg_to_svg.py`
- [ ] `application/src/main/java/org/thingsboard/server/controller/CadController.java`
- [ ] `application/src/main/java/org/thingsboard/server/service/entitiy/cad/DefaultCadService.java`
- [ ] `application/src/main/java/org/thingsboard/server/service/entitiy/cad/CadPerEntityResult.java`
- [ ] `application/src/main/java/org/thingsboard/server/service/entitiy/cad/CadEntityInfo.java`
- [ ] `ui-ngx/src/app/shared/models/cad-per-entity.models.ts`
- [ ] `ui-ngx/src/app/modules/home/components/dashboard-page/cad-import-dialog/cad-import-dialog.component.ts`
- [ ] `ui-ngx/src/app/modules/home/components/dashboard-page/cad-import-dialog/cad-import-dialog.component.html`
- [ ] `ui-ngx/src/app/modules/home/components/dashboard-page/cad-import-dialog/cad-import-dialog.component.scss`
- [ ] `ui-ngx/src/app/modules/home/components/dashboard-page/dashboard-page.component.ts`
- [ ] `ui-ngx/src/app/core/services/dashboard-utils.service.ts`
- [ ] `ui-ngx/src/app/modules/home/components/dashboard/dashboard.component.ts`
- [ ] `ui-ngx/src/app/modules/home/components/widget/lib/scada/scada-symbol.models.ts`

## Phase 1: Establish A Single CAD Transform Contract

- [ ] Add manifest fields for global transform data: `modelspaceBounds`, `previewViewBox`, `scale`, `translate`, `yFlip`, and any output canvas dimensions required by the frontend.
- [ ] Ensure `preview.svg` viewBox and manifest coordinate fields are generated from the same modelspace bounds.
- [ ] Use or replace `_rewrite_viewbox_to_cad_wcs()` so that downstream code can map manifest `x/y/width/height` to preview coordinates without guessing.
- [ ] Extend Java DTOs and TypeScript models to carry the transform fields.
- [ ] Remove frontend regex-based viewBox inference from `previewSvgBase64` once transform data is available.
- [ ] Add tests or assertions that CAD WCS points round-trip to preview coordinates through the returned transform.

**Acceptance checklist:**

- [ ] Five sampled entities of different types map from CAD bbox to preview bbox within 1-2 px or a documented tolerance.
- [ ] The frontend can render overlay positions without parsing `viewBox` from SVG text.
- [ ] The manifest contains enough information to reconstruct preview and dashboard placement deterministically.

## Phase 2: Restore Preview Visual Fidelity

- [ ] Remove blanket preview `stroke-width` enlargement.
- [ ] Replace simple color string replacements with structured SVG/style handling.
- [ ] Preserve layer color, BYLAYER/BYBLOCK behavior, lineweight, linetype, fill, hatch, text rotation, and block insert transforms as far as `ezdxf` permits.
- [ ] Make background rectangle removal safe: remove only known generated background nodes, not any legitimate CAD rect with a similar fill.
- [ ] Avoid converting white strokes/fills to black unless there is an explicit theme or background policy.
- [ ] Define the preview background color separately from CAD entity colors so original drawing colors remain meaningful.

**Acceptance checklist:**

- [ ] A full exported `preview.svg` visually matches AutoCAD or a direct full-SVG export for line colors, fills, and relative placement.
- [ ] White, black, colored, thick, and thin lines remain distinguishable.
- [ ] Lines no longer appear hollow or artificially doubled due to stroke-width post-processing.

## Phase 3: Select And Delete Real Preview Entities

- [ ] Emit stable entity identifiers into preview SVG groups or elements, for example `data-cad-entity-id`.
- [ ] Make frontend selection operate on real SVG groups/elements when possible, not just bbox rectangles.
- [ ] Keep bbox overlays as optional visual affordances only.
- [ ] Implement frame selection against real entity geometry bbox or path intersection.
- [ ] Make delete immediately hide/remove the matching preview SVG group and update `keptEntities`.
- [ ] Ensure deleted entity IDs are excluded from dashboard import.

**Acceptance checklist:**

- [ ] A block, a line, and a text element can each be selected in preview.
- [ ] Deleting selected entities removes them from both preview and final imported dashboard output.
- [ ] Selection does not accidentally select unrelated entities merely because large bboxes overlap.

## Phase 4: Map Entities Directly From Preview

- [ ] Define preview interaction modes if needed: select mode, frame-select mode, map mode, pan/zoom mode.
- [ ] On real entity click in map mode, open `CadWidgetSelectDialogComponent`.
- [ ] Store mapping in the same `mappings` map used by the list step.
- [ ] Reflect preview-created mappings in the map list and review step.
- [ ] Keep list-based mapping as a fallback for keyboard/accessibility and precise selection.

**Acceptance checklist:**

- [ ] Clicking an entity in preview can map it to a dashboard widget.
- [ ] Mapping created in preview appears as mapped in the map step list.
- [ ] Removing a mapping from the list updates the review/import result.

## Phase 5: Reconstruct CAD Geometry In Dashboard

Choose one implementation path before coding this phase.

### Option A: Full SVG Background Plus Widget Overlays

- [ ] Import one global full-CAD SVG as a SCADA/static background.
- [ ] Use the shared transform to place mapped widgets over the relevant CAD entities.
- [ ] Deleted entities should be removed/hidden in the global SVG before upload/import.
- [ ] Unmapped visual-only CAD entities remain in the background SVG instead of becoming independent widgets.
- [ ] Use entity widgets only where live ThingsBoard behavior is required.

### Option B: Per-Entity Widgets With Global Coordinates

- [ ] Generate dashboard entity SVGs with a shared global canvas viewBox.
- [ ] Or include an inverse transform so each entity's internal geometry aligns exactly with its widget bbox.
- [ ] Do not apply arbitrary per-entity padding or independent normalization to dashboard SVG assets.
- [ ] Keep per-entity normalized SVGs only for thumbnails.
- [ ] Ensure SCADA symbol resize preserves global placement semantics.

**Acceptance checklist:**

- [ ] Importing without manual mappings reconstructs the original CAD shape at dashboard level.
- [ ] Relative position and scale between entities match preview and AutoCAD.
- [ ] Overlapping CAD entities remain overlapping after dashboard import.

## Phase 6: Match Dashboard Grid To CAD Aspect Ratio

- [ ] Compute dashboard grid placement from the same modelspace bounds used by preview.
- [ ] Set or derive row height / layout dimension so dashboard pixel aspect ratio matches CAD width/height.
- [ ] Avoid normal Gridster collision relocation during CAD bulk import, or make CAD import use a layout path that preserves exact coordinates.
- [ ] Increase grid precision or define a quantization strategy for tiny entities.
- [ ] Make rounding deterministic and testable.

**Acceptance checklist:**

- [ ] `columns`, row sizing, and CAD modelspace aspect ratio produce the same visual proportions.
- [ ] Very small lines/text are not moved or inflated unpredictably.
- [ ] Collision handling does not move CAD widgets away from their source positions.

## Phase 7: Golden Fixture And Verification Suite

Create or select CAD fixtures that include:

- [ ] Different layer colors.
- [ ] White, black, and colored strokes/fills.
- [ ] Thin and thick lineweights.
- [ ] Horizontal and vertical lines.
- [ ] Closed polylines.
- [ ] Hatch/fill.
- [ ] `TEXT` and `MTEXT`.
- [ ] Rotated blocks.
- [ ] Nested `INSERT`.
- [ ] Overlapping entities.
- [ ] Very small entities.

Backend verification:

- [ ] Run conversion for the fixture and inspect `preview.svg` plus `manifest.json`.
- [ ] Assert transform fields exist and are finite.
- [ ] Assert sampled manifest bboxes map to preview positions within tolerance.
- [ ] Assert no blanket stroke-width/color rewrites alter known fixture colors.

Frontend verification:

- [ ] Unit-test CAD WCS to preview viewport conversion.
- [ ] Unit-test CAD WCS to dashboard grid conversion.
- [ ] Unit-test deletion state: selected/deleted entities are excluded from import.
- [ ] Unit-test preview-created mapping and list-created mapping share the same data model.

End-to-end verification:

- [ ] Upload fixture CAD from dashboard edit page.
- [ ] Compare preview screenshot against AutoCAD/direct SVG reference.
- [ ] Frame-select and delete one block, one line, and one text element.
- [ ] Click a preview entity and map it to a widget.
- [ ] Import with some unmapped entities.
- [ ] Compare final dashboard screenshot against expected retained CAD geometry.

## Final Definition Of Done

- [ ] Preview looks like AutoCAD or direct full-SVG export within documented tolerance.
- [ ] Entity colors, lineweights, fills/hatches, text, and block transforms are preserved as far as supported by the converter.
- [ ] Lines do not appear hollow because of artificial stroke or background manipulation.
- [ ] Blocks, lines, and text can be selected in preview.
- [ ] Selected entities can be deleted and are absent from final dashboard import.
- [ ] Preview click can map an entity to a dashboard widget.
- [ ] Unmapped CAD geometry imported to dashboard preserves original relative position and scale.
- [ ] Dashboard grid aspect ratio matches CAD modelspace aspect ratio.
- [ ] Collision handling does not move CAD-derived widgets.
- [ ] The implementation has backend transform tests, frontend conversion tests, and at least one screenshot/visual comparison workflow.

## Suggested Review Questions

- [ ] Does every coordinate conversion start from the same backend transform contract?
- [ ] Is any code still parsing SVG text to infer layout-critical coordinates?
- [ ] Are thumbnail SVGs and dashboard SVG assets separated when their coordinate requirements differ?
- [ ] Can a deleted preview entity still survive in the uploaded SVG or generated widgets?
- [ ] Can Gridster collision handling still move imported CAD geometry?
- [ ] Do tests include overlapping, rotated, text, hatch, and tiny-entity cases?

