---
feature: cad-import-dashboard
status: delivered
specs:
  - .sisyphus/plans/cad-import-dashboard.md
branch: feat/cad-import-dashboard
---

# CAD Import to Dashboard — Final Report

## What Was Built

A "从CAD导入" (Import from CAD) button added to the ThingsBoard dashboard edit-mode toolbar. When clicked, it opens a fullscreen dialog with a 4-step wizard:

1. **Upload** — User selects a `.dwg` or `.dxf` CAD file. The backend invokes a Python script (via ProcessBuilder) that parses the drawing into per-entity SVGs with bounding box metadata.
2. **Preview & Select** — A canvas renders all entities at their original CAD positions using svg.js. Users can rectangle-drag to select entities and delete/keep them.
3. **Map to Widgets** — Each kept entity can be mapped to a widget from the library (via DashboardWidgetSelectComponent). Unmapped entities become static SCADA Symbol widgets.
4. **Review & Import** — Summary of mappings, then imports all widgets into the dashboard at CAD-derived positions using SCADA layout (1000-column grid).

## Architecture

### Backend (Java/Spring)

- **New endpoint**: `POST /api/cad/convert-per-entity` in `CadController.java`
- **Service**: `DefaultCadService.convertDwgToPerEntitySvg()` — validates file, creates temp dir, invokes Python script with `--per-entity --max-entities` flags, reads manifest.json + per-entity SVGs, applies SVG sanitization via `containsUnsafeContent()`
- **DTOs**: `CadPerEntityResult` (previewSvgBase64 + manifest list), `CadEntityInfo` (id, type, svgBase64, x, y, width, height, blockName)
- **Config**: `CadConfig.maxEntities` (default 5000, configurable via `CAD_MAX_ENTITIES` env var)
- **Startup validation**: `@PostConstruct validateEnvironment()` warns if Python script path missing

### Python Script (`dwg_to_svg.py`)

- **New function**: `dxf_to_per_entity_svgs()` — reads DXF fresh (no mutation), iterates modelspace entities, computes bbox via `ezdxf_bbox.extents()`, expands INSERT entities recursively (max depth 3), renders each entity to individual SVG via temp doc + `add_foreign_entity()`, writes manifest.json
- **CLI flags**: `--per-entity`, `--max-entities N`
- **Supported types**: LINE, CIRCLE, ARC, ELLIPSE, SPLINE, LWPOLYLINE, POLYLINE, TEXT, MTEXT, INSERT, HATCH, DIMENSION

### Frontend (Angular)

- **Dialog**: `CadImportDialogComponent` — fullscreen dialog with 4-step wizard, svg.js canvas for preview, rectangle-drag selection, widget mapping UI
- **Service**: `ImportExportService.importCadFilePerEntity()` — hidden file input + FormData POST to backend
- **Models**: `CadPerEntityResult`, `CadEntityInfo` interfaces in `cad-per-entity.models.ts`
- **Toolbar**: Button pair (icon-only + stroked) in `@if(isEdit)` block, opens dialog
- **Widget creation**: `createWidgetForEntity()` — mapped widgets use WidgetType default config + `prepareWidgetForScadaLayout()`, unmapped widgets use SCADA Symbol widget with inline SVG content
- **Coordinate scaling**: `scaleCadToGrid()` — normalizes CAD bbox to 1000×1000 SCADA grid with Y-flip, min 1×1 size, clamping

## Key Design Decisions

- **On-demand Python invocation** via ProcessBuilder (no separate Python service) — matches existing CAD module pattern
- **Per-entity SVG rendering** uses temp doc + `add_foreign_entity()` — generalizes existing `_render_block_to_svg()` pattern
- **BBox computation** via `ezdxf_bbox.extents()` (not the existing `_entity_points()` which misses CIRCLE radius/ARC angles/TEXT extent)
- **SCADA layout** with 1000 columns (not 3000) — per locale constraint
- **Unmapped entities** become static SCADA Symbol widgets — user configures datasources after import via normal widget edit

## Verification

- **Backend**: Maven compile with Java 25 (`BUILD SUCCESS`)
- **Frontend**: TypeScript check passes (no errors in source files)
- **Python**: Smoke test passes — `--per-entity` flag extracts 6 entities from test DXF, manifest.json valid, all SVGs generated
- **Regression**: Existing `--test` and `--invert` flags unchanged
- **Playwright E2E**: Deferred (requires running ThingsBoard instance)

## Files Changed

| File | Change |
|------|--------|
| `test/dwg_to_svg.py` | Added `dxf_to_per_entity_svgs()`, `_entity_bbox()`, `_expand_insert()`, `--per-entity`/`--max-entities` CLI flags |
| `application/.../CadController.java` | Added `POST /api/cad/convert-per-entity` endpoint |
| `application/.../CadService.java` | Added `convertDwgToPerEntitySvg()` interface method |
| `application/.../DefaultCadService.java` | Added implementation + `@PostConstruct` validation |
| `application/.../CadPerEntityResult.java` | New DTO |
| `application/.../CadEntityInfo.java` | New DTO |
| `application/.../CadConfig.java` | Added `maxEntities` field |
| `application/src/main/resources/thingsboard.yml` | Added `cad.max-entities` config |
| `ui-ngx/.../cad-per-entity.models.ts` | New frontend models |
| `ui-ngx/.../import-export.service.ts` | Added `importCadFilePerEntity()` method |
| `ui-ngx/.../cad-import-dialog/` | New dialog component (4 files) |
| `ui-ngx/.../dashboard-page.component.html` | Added toolbar button |
| `ui-ngx/.../dashboard-page.component.ts` | Added `importFromCad()` method |
| `ui-ngx/.../home-components.module.ts` | Registered dialog component |
| `ui-ngx/.../locale.constant-en_US.json` | Added translation keys |
| `ui-ngx/.../locale.constant-zh_CN.json` | Added Chinese translations |
