# CAD background and color policy

The import editor now offers **Keep background and original colors** (default) and
**Remove CAD background (adapt colors)**, with an opaque destination canvas color
(default white). This does not re-upload or re-run the DWG parser.

Keep mode retains the converter's canvas and paint values. Remove mode omits only
`data-cad-background=true` pipeline canvases; real CAD rectangles, hatch geometry,
white glyph outlines and equipment shapes are never deleted by color or size.
Independent and grouped resources stay transparent. The dashboard layout uses the
chosen destination canvas, so clearing an existing black CAD layout cannot leave
adapted dark strokes displayed over that same black layout. This is removal of the
CAD source canvas, not an assertion that the dashboard browser surface is transparent.

Solid low-contrast colors (<3:1 relative-luminance contrast against that canvas)
are adapted on already validated, detached SVG nodes. Neutral white/light gray
becomes a dark neutral on white; dark strokes become light on dark canvases.
Already legible colors remain exactly unchanged. Low-contrast vivid colors are
shaded/tinted, not hue-inverted. This is a display policy, not plotter-color fidelity
or a guarantee about overlapping geometry, hairline antialiasing or translucent fills.
Opacity, alpha paints, gradients, mask/clip geometry and definitions are deliberately
preserved; exotic paints can still require manual review. Mapped replacement widgets
are intentionally NOT recolored (their own alarm/behavior colors are independent).

Preview, thumbnails, independent SCADA symbols, manually grouped symbols, optional
merged static resources and the layout all consume the same settings. Toggling
back to Keep rebuilds from untouched original entity assets, not from previously
adapted output. Geometry, IDs, deletion state and mappings stay unchanged.
The chosen policy is saved as `config.cadBackground` along with actual inline SVG.
Export/reload retains concrete paints. Changing the dashboard canvas AFTER import
does not dynamically recolor those saved paints; reimport for a different target.
Old flattened dashboards are not silently migrated. Reimport the DWG to choose a policy.

Validation: standalone color-policy and layout checks plus actual Chromium regressions
cover white/gray stroke and glyph fill adaptation, saturated-color preservation/shading,
black destination, group/individual/background parity, JSON SVG round trips,
reversibility, real rectangle retention, inherited styles/currentColor, masks,
opacity, cancellation, existing SVG security checks and a 1200-instance yielding
build. Image artifacts show both modes. Existing CAD and Angular template compilation
remain enabled. This does not certify ODA/AutoCAD fidelity or a running server E2E.
