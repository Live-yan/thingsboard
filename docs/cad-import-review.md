# CAD scene, deletion consistency and bounded large-file processing

Review base: `7cff95e99c9584df09878793066f3c29fb45edfe`. Implementation extends
PR #1 on `fix/cad-scene-deletion-parity`; it does not change master or migrate
already saved dashboards.

## Implemented contract

```text
Immutable original DWG/DXF
  -> bounded InputStream -> temporary file + SHA-256
  -> DWG: configured ODA converter -> DXF
  -> original ezdxf document/context -> one primitive recording
  -> scene schema v2 (source fingerprint, top-level handles, one renderer matrix)
  -> instance-owned SVG groups / per-instance resources
  -> CadSceneState (deleted instance IDs, bounded undo history)
  -> time-sliced editable preview / static background export
  -> one background resource + only explicitly mapped live widgets
```

`cad_scene.py` records the original document once. Each top-level handle owns its
nested geometry and ATTRIB glyphs. It does not expand repeated block instances
into unrelated array-index IDs, copy entities into a context without their
original layers, or independently normalize geometry for the preview and export.
The manifest carries actual renderer placement coordinates, not a guessed scale
based on a different output-coordinate constant. Hidden/unsupported entities and
skipped primitives are reported. The background uses the full scene frame even
after deleting or mapping an outer entity.

The frontend validates the static SVG subset, inlines entity-local class styles,
isolates defs IDs, retains coordinate viewports, and decodes UTF-8 explicitly.
Deleting an instance removes its actual group, not an opaque rectangle over its
bbox; crossing geometry from retained instances remains visible.

## What deletion and saving mean

- The default operation is **selected top-level instances only**. Two INSERTs
  of `PUMP` have different handles. Removing one never alters the BLOCK definition
  or the other instance, including nested INSERTs and attributes.
- All IDs in a batch are validated before mutation. Duplicate IDs in a batch are
  deduplicated. Up to 20 deletion operations can be undone. Undo restores geometry,
  not previously removed device/group bindings; the toolbar states this explicitly.
- Preview, retained-entity counts, mapping and export consume the same scene state.
  Return-to-preview reconstructs only retained IDs.
- A versioned `{version, sceneId, deletedEntityIds}` snapshot is attached once to
  the generated widget configuration as `cadSceneEdits`, alongside the retained
  background resource. Normal dashboard save/JSON export retains that configuration.
- Reuploading the **exact same source file** permits explicit restoration from
  the current dashboard. Wrong-source hashes, unknown IDs, duplicate IDs and future
  schema versions are rejected without partial state changes. Multiple matching
  snapshots are not silently resolved. Geometry is not stored redundantly in every
  widget or browser localStorage.
- This is **not a cleaned DWG/DXF writer**, server-side CAD document repository,
  collaborative editing service or automatic device/telemetry/RPC binding.
  Original CAD bytes are not retained after temporary conversion cleanup; keep
  the source file to re-edit. Exported dashboards must include image resources
  when transferring to another installation.

## Large files: bounded work, not an unlimited-file guarantee

The HTTP controller no longer materializes `MultipartFile.getBytes()` for CAD.
It stages input using a 64 KiB buffer, checks the actual count independently of
reported length, validates a bounded header, hashes while copying, and removes
partial files on failure. Binary DXF and initial ASCII DXF comment pairs are
accepted. Fixed staging filenames prevent upload filenames from becoming paths.

A service instance admits at most two simultaneous conversions and one per tenant
by default; excess work receives HTTP 429, not an unbounded queue. A wall-clock
timeout and output-byte budget stop runaway conversion, with subprocess-tree
termination on abnormal execution. Python also caps primitive/segment counts,
block nesting and total generated SVG bytes. A single instance SVG is capped at
4 MiB to bound synchronous browser parsing. These limits deliberately reject
oversized complexity instead of silently truncating a drawing.

The schema-v2 response omits the duplicate whole-preview base64. Frontend scene
construction yields after a time slice or 50 instances, supports AbortSignal,
and does not attach a partially built scene. Export yields between serialization
and base64 batches. The map list shows at most 50 entities and 50 groups per page;
thumbnail object URLs and widget-type lookups are cached and released. Indexed
entity lookup and cached summaries avoid repeated full scans during selection.
Automatic group matching is bounded to 200 candidates, 16 members and a 10,000-step
search budget; limit hits are reported for manual mapping, not guessed matches.

**Remaining boundaries:** upload/response handling is still a single HTTP request,
not a durable conversion-job API, chunked/resumable upload or progressive manifest
stream. Closing the dialog aborts its XHR and local build, but does not forcibly
cancel a converter already running server-side; its timeout still applies. Full
JSON response parsing, one large entity's XML parsing and final strings can still
create long tasks. Admission limits are per service instance, not cluster-wide.
A resource upload that succeeded before another item failed can remain orphaned;
partial imports now stay open with an error rather than silently saving missing
geometry, but transactional resource cleanup is a separate follow-up.

## Deployment configuration

Existing upload defaults remain **50 MiB / 5,000 top-level entities**. Do not raise
only one limit. For an evaluated 128 MiB upload tier, configure all relevant layers:

```sh
CAD_MAX_FILE_SIZE=128
SPRING_SERVLET_MULTIPART_MAX_FILE_SIZE=128MB
SPRING_SERVLET_MULTIPART_MAX_REQUEST_SIZE=129MB
CAD_MAX_ENTITIES=5000
CAD_MAX_CONCURRENT_CONVERSIONS=2
CAD_MAX_OUTPUT_SIZE_MB=64
CAD_CONVERSION_TIMEOUT=300
ODA_FILE_CONVERTER=/installed/path/to/ODAFileConverter
```

The request budget includes multipart overhead. Set reverse-proxy body size and
upstream timeouts consistently, retain servlet multipart disk spooling (default
zero threshold), and allocate temporary disk for concurrent uploads/conversions.
Use ezdxf **1.4.4**, which is the API version pinned in regression CI; verify any
upgrade against the canonical-render tests. DWG still requires an installed,
licensed ODA converter; headless Linux execution may additionally require the
installation's display-wrapper configuration. The corrected argument order
includes both recursion and audit flags. ODA is not installed or executed by the
public DXF regression suite.

The separate legacy `/cad/convert` block-definition symbol-library route retains
its previous drawing implementation. `/cad/convert-per-entity`, editable preview,
retained SCADA background resources and dashboard generation use the canonical
scene. This distinction avoids presenting a rewrite of the legacy route as done.

## Regression and acceptance evidence

The workflow runs relevant PRs, master pushes and manual dispatch with read-only
repository permissions. Independent suites still execute after another test suite
fails; setup failures are not mistaken for code failures.

- Existing 12 Python tests remain enabled.
- Every standalone `cad*.spec.ts` is discovered; the layout helper now has type-only
  model imports, avoiding the Angular runtime alias that previously broke CI.
- Strict compilation of the actual SVG scene/state/import helper code.
- Real Chromium style/ID isolation, safe-SVG rejection, geometry hit testing,
  UTF-8, deletion/rebuild and preview/export image comparisons.
- Real DXF rendering of repeated, rotated/mirrored/nested blocks and ATTRIBs;
  stable identities, original layer colors, matrix coordinates, degenerate scenes,
  cycles and explicit complexity failures.
- Source-scoped JSON save/reload/edit-state validation and same-block-instance
  deletion followed by async export. A 50,000-instance state case checks bulk edits.
- **128 MiB generated input staged under `java -Xmx32m`**, with hash verification,
  malformed/lying/truncated inputs and interrupted-copy cleanup. This exercises
  production `CadUploadIO`, not the complete servlet or Java application.
- **64 MiB of synthetic DXF comments plus 5,000 LINEs**, parsed/rendered using the
  production converter. The 60-second guard detects gross regression, not an SLA.
- **1,500 browser instances**, checking that preview and export permit event-loop
  heartbeats, retain Unicode and produce one static background; cancellation must
  not attach partial geometry.
- A separate full UI dependency installation and Angular application/template
  compilation job. Its actual result must be read from the PR checks.

Artifacts contain JUnit, preview/export PNGs and JSON measurement reports. Timing
is environment/dataset-specific; comment-heavy DXF byte size does not simulate
64 MiB of dense hatch/spline geometry. Successful helper tests do not establish
production large-DWG performance, full Java integration, memory isolation of ODA,
or deployed upload -> dashboard save -> reload -> device-control E2E behavior.

References: ezdxf drawing/recorder/layout documentation
(https://ezdxf.readthedocs.io/en/stable/addons/drawing.html), entity handles
(https://ezdxf.readthedocs.io/en/stable/dxfinternals/handles.html), Spring MultipartFile
(https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/multipart/MultipartFile.html).
