# Real CAD fixture: fonts and conversion performance

Base: `2d7cf1310f4f02d98e26981d9eca01031dfabe75`. Fixture: `files/testfile.dwg`
(327,821 bytes). Keep this distinction: a small DWG may contain complex geometry,
but a large HTTP byte count is not itself evidence that rendering is slow.

## What changed

* The web conversion route writes a **single bounded JSON manifest** containing
  each instance SVG. Java consumes its existing base64, rather than opening every
  small file, allocating another UTF-8 buffer and encoding it again. Duplicate
  full-preview serialization is omitted. Standalone CLI SVG-folder export stays
  available. The instance geometry, positions and viewBox are byte-identical in
  file/bundle tests; neither simplification nor rasterization is used for speed.
* Successful small results are kept in a tenant-isolated, process-local LRU.
  Keys include tenant, source content hash, file format, entity/output limits and
  Python module revision. Default: 60-second TTL, 16 MiB total, 4 MiB per entry,
  32 entries. Large results and failures are not cached. Input is still validated
  and streamed before a hit; this is not upload deduplication or a shared CDN.
  Returned values cannot mutate cached data. Restart invalidates the cache.
* `timings` reports readDxfMs, fontSetupMs, recordGeometryMs, svgAndResourcesMs,
  sceneTotalMs, uploadMs, pythonAndDwgMs, readResultMs and requestTotalMs;
  `cacheHit` identifies a reuse. On cache hits timings describe THIS request.
  uploadMs is server staging, **not browser/network upload time**. The difference
  between pythonAndDwgMs and sceneTotalMs includes Python startup and DWG decoding.
  Measure that on the deployed ODA installation before claiming a decoder speedup.

## Romans / TXT do not prevent SCADA conversion

DXF STYLE names often omit `.shx`. Previously `has_font("romans")` reported a
missing font even when `romans.shx` was installed. Resolution now uses the same
face for diagnostics and rendering, once per STYLE: exact SHX first, known
available equivalent second, explicit fallback last. Text is converted into SVG
paths, so the resulting SCADA does not require that font in the browser.

Exact original fonts are not bundled or downloaded. Only fonts the operator is
entitled to use should be installed. On Windows the known
`Program Files/Autodesk/AutoCAD*/Fonts` locations are discovered. Other locations:

```powershell
$env:CAD_FONT_DIRS = 'D:\CAD-Fonts;C:\Program Files\Autodesk\AutoCAD 2026\Fonts'
```

On Linux use colon-separated existing directories (`CAD_FONT_DIRS=/opt/cad-fonts`).
This variable must reach the Java process and its Python child. Missing explicitly
configured directories fail clearly. Font paths INSIDE uploaded drawings never
cause arbitrary filesystem reads. A TTF equivalent remains identified as a
substitute, not falsely labelled the exact SHX. Big-font composition is a separate
warning. Installing exact original fonts may change text metrics; re-convert.

Change cache settings with `CAD_CACHE_SIZE_MB` (0 disables) and
`CAD_CACHE_TTL_SECONDS`, or `cad.cache-size-mb` / `cad.cache-ttl-seconds` properties.
Restart after changing fonts or disable the cache; otherwise a previous font
result can remain until its short TTL expires. No font files appear in artifacts.

## Reproducible verification

`CAD real DWG fixture` builds a fixed LibreDWG 0.13.3 test decoder, decodes the
committed file, records decoder diagnostics, and runs the production DXF parser.
It asserts the 73 entities produced by that decoder (57 LINE, 11 TEXT plus other
geometry), every instance ID, equal frames/matrices and byte-identical file vs
bundled SVGs. Five alternating trials plus cProfile produce measurement.json and
profile.txt. There is no artificial latency or weakened geometry limit in tests.

LibreDWG emits warnings on this file, including unresolved handles and unsupported
class fields. Its output is a **diagnostic fixture, not an ODA/AutoCAD reference**.
Production still uses ODA. A passing fixture test does not establish complete DWG
recovery, full Java application integration, or deployed dashboard E2E performance.
Java's production bounded cache/decoder and input stream are exercised separately
with javac and a 32 MiB heap. Angular/template and existing geometry/browser tests
continue in the CAD regression workflow. Absolute times depend on runner and fonts.

The companion independent-components PR removes one image-upload request per
unmapped component using ThingsBoard's existing inline SCADA content setting.
That frontend change is not required for this backend PR and is not claimed here.
