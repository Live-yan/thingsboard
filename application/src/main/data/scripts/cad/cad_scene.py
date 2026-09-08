#
# Copyright © 2016-2026 The Thingsboard Authors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
"""Canonical, instance-owned CAD scene. Requires ezdxf 1.4.4.

Render the original document exactly once. Preview and entity resources are
projections of that recording, not independently normalized drawings. A top-level
INSERT owns every nested primitive, including ATTRIBs; deleting one instance
never changes its shared BLOCK definition or another INSERT.
"""
from __future__ import annotations

import base64
import copy
import hashlib
import json
import math
import os
import re
import time
from time import perf_counter
from pathlib import Path
import xml.etree.ElementTree as ET

import ezdxf
from ezdxf.addons.drawing import Frontend, RenderContext, layout, svg, recorder
from ezdxf.addons.drawing.config import BackgroundPolicy, Configuration, ImagePolicy
from ezdxf.fonts import fonts
from ezdxf.render import hatching
from ezdxf.math import BoundingBox2d, Vec2
from cad_svg_precision import PrecisionSvgRenderer, number
from cad_fonts import CadFontContext, font_basename

SCHEMA_VERSION = 3
COORDINATE_SPACE = 100_000
MAX_RECORDS = 200_000
MAX_VERTICES = 2_000_000
MAX_NESTING = 32
MAX_OUTPUT_BYTES = 128 * 1024 * 1024


class SceneLimitError(ValueError):
    """Fail explicitly rather than silently dropping part of a complex drawing."""


class SceneRenderer(PrecisionSvgRenderer):
    def __init__(self, page, settings, origins):
        super().__init__(page, settings)
        self.origins = origins
        self.container = self.entities
        self.groups = {}
        self.stroke_widths = {}

    def group(self, properties):
        handle = properties.handle
        if handle not in self.groups:
            group = ET.SubElement(self.container, 'g', {
                'data-cad-entity-id': 'cad-' + handle,
                'stroke-linecap': 'round', 'stroke-linejoin': 'round',
                'fill-rule': 'evenodd',
                'transform': f'translate({number(self.origin.x)} {number(self.origin.y)})',
            })
            self.groups[handle] = group
        return self.groups[handle]

    def draw_point(self, pos, properties):
        self.origin = self.origins[properties.handle]
        super().draw_point(pos, properties)

    def draw_line(self, start, end, properties):
        self.origin = self.origins[properties.handle]
        super().draw_line(start, end, properties)

    def draw_solid_lines(self, lines, properties):
        self.origin = self.origins[properties.handle]
        super().draw_solid_lines(lines, properties)

    def draw_path(self, path, properties):
        self.origin = self.origins[properties.handle]
        super().draw_path(path, properties)

    def draw_filled_paths(self, paths, properties):
        self.origin = self.origins[properties.handle]
        super().draw_filled_paths(paths, properties)

    def draw_filled_polygon(self, points, properties):
        self.origin = self.origins[properties.handle]
        super().draw_filled_polygon(points, properties)

    def add_strokes(self, d, properties):
        if not d:
            return
        color, opacity = self.resolve_color(properties.color)
        width = self.resolve_stroke_width(properties.lineweight)
        self.stroke_widths[properties.handle] = max(width, self.stroke_widths.get(properties.handle, 0))
        ET.SubElement(self.group(properties), 'path', {
            'd': d, 'fill': 'none', 'stroke': color,
            'stroke-opacity': str(opacity), 'stroke-width': number(width),
        })

    def add_filling(self, d, properties):
        if d:
            color, opacity = self.resolve_color(properties.color)
            ET.SubElement(self.group(properties), 'path', {
                'd': d, 'stroke': 'none', 'fill': color, 'fill-opacity': str(opacity),
            })


class SceneRecorder(svg.SVGBackend):
    def __init__(self, max_records=MAX_RECORDS, max_vertices=MAX_VERTICES):
        super().__init__()
        self.owner = ''
        self.max_records = max_records
        self.max_vertices = max_vertices
        self.vertices = 0
        self.renderer = None

    def store(self, record, properties):
        if len(self.records) >= self.max_records:
            raise SceneLimitError(f'CAD exceeds {self.max_records} rendered primitives')
        if isinstance(record, recorder.FilledPathsRecord):
            size = sum(len(path) for path in record.paths)
        elif isinstance(record, recorder.PathRecord):
            size = len(record.path)
        elif isinstance(record, recorder.SolidLinesRecord):
            size = len(record.lines)
        elif isinstance(record, recorder.PointsRecord):
            size = len(record.points)
        else:
            size = 1
        self.vertices += size
        if self.vertices > self.max_vertices:
            raise SceneLimitError(f'CAD exceeds {self.max_vertices} geometry segments')
        super().store(record, properties._replace(handle=self.owner))

    def make_backend(self, page, settings):
        self.renderer = SceneRenderer(page, settings, {handle: bb.extmin for handle, bb in bounds_by_handle(self.records).items()})
        return self.renderer


class SceneFrontend(Frontend):
    def __init__(self, ctx, backend):
        super().__init__(ctx, backend, config=Configuration(
            background_policy=BackgroundPolicy.DEFAULT,
            image_policy=ImagePolicy.IGNORE,
            hatching_timeout=5.0,
        ))
        self.scene_backend = backend
        self.depth = 0
        self.skipped_count = 0
        self.warnings = []
        self.warned_fonts = set()

    def draw_entity(self, entity, properties):
        if self.depth >= MAX_NESTING:
            raise SceneLimitError(f'CAD block nesting exceeds {MAX_NESTING}')
        if self.depth == 0:
            handle = str(entity.dxf.handle).upper()
            if not re.fullmatch(r'[0-9A-F]{1,32}', handle):
                raise ValueError('Invalid CAD instance handle')
            self.scene_backend.owner = handle
        self.depth += 1
        try:
            if entity.dxftype() in ('TEXT', 'MTEXT', 'ATTRIB', 'ATTDEF') and entity.doc is not None:
                style_name = entity.dxf.get('style', 'Standard')
                warning = self.ctx.font_warning(style_name) if isinstance(self.ctx, CadFontContext) else None
                if warning and warning[0].lower() not in self.warned_fonts:
                    self.warned_fonts.add(warning[0].lower())
                    if len(self.warnings) < 100:
                        self.warnings.append({'handle': self.scene_backend.owner, 'type': 'FONT', 'reason': warning[1]})
                # Bigfont composition is not implemented by the drawing backend.
                style = entity.doc.styles.get(style_name)
                bigfont = font_basename(style.dxf.get('bigfont', ''))
                if bigfont and ('big:' + bigfont.lower()) not in self.warned_fonts:
                    self.warned_fonts.add('big:' + bigfont.lower())
                    if len(self.warnings) < 100:
                        self.warnings.append({'handle': self.scene_backend.owner, 'type': 'BIGFONT',
                            'reason': 'Bigfont composition is unsupported; check text glyphs: ' + bigfont[:200]})
            if entity.dxftype() == 'IMAGE':
                # Never fetch arbitrary image paths from an uploaded document.
                self.skip_entity(entity, 'External raster IMAGE is not embedded in the upload; image content is not rendered')
                return
            if entity.dxftype() == 'INSERT':
                block = entity.block()
                if block is not None and block.block.is_xref and not len(block):
                    self.skip_entity(entity, 'External XREF content requires a bound/self-contained drawing')
                    return
            super().draw_entity(entity, properties)
        finally:
            self.depth -= 1

    def draw_hatch_pattern(self, polygon, paths, properties):
        # ezdxf's default accumulates all lines and returns a partial hatch after
        # timeout; dense patterns can silently become a solid fill. Neither is
        # acceptable for an editable CAD import. Stream bounded chunks or fail.
        if polygon.pattern is None or not polygon.pattern.lines:
            return
        deadline = time.monotonic() + self.config.hatching_timeout
        properties.linetype_pattern = tuple()
        ocs = polygon.ocs()
        elevation = polygon.dxf.elevation.z
        pending = []

        def timed_out():
            if time.monotonic() > deadline:
                raise SceneLimitError('CAD hatch rendering timed out; simplify the pattern or split the drawing')
            return False

        try:
            for baseline in hatching.pattern_baselines(polygon,
                    min_hatch_line_distance=self.config.min_hatch_line_distance, jiggle_origin=True):
                timed_out()
                for line in hatching.hatch_paths(baseline, paths, timed_out):
                    for start, end in baseline.pattern_renderer(line.distance).render(line.start, line.end):
                        timed_out()
                        if ocs.transform:
                            start = ocs.to_wcs((start.x, start.y, elevation))
                            end = ocs.to_wcs((end.x, end.y, elevation))
                        pending.append((start, end))
                        if len(pending) >= 1024:
                            self.pipeline.draw_solid_lines(pending, properties)
                            pending = []
        except hatching.DenseHatchingLinesError as error:
            raise SceneLimitError('CAD hatch pattern is too dense; refusing a misleading solid-fill fallback') from error
        if pending:
            self.pipeline.draw_solid_lines(pending, properties)

    def skip_entity(self, entity, reason):
        self.skipped_count += 1
        if len(self.warnings) < 100:
            self.warnings.append({'handle': entity.dxf.get('handle', ''),
                                  'type': entity.dxftype(), 'reason': str(reason)[:500]})


def file_sha256(path: Path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def bounds_by_handle(records):
    result = {}
    for record in records:
        bounds = record.bbox()
        if bounds.has_data:
            result.setdefault(record.handle, BoundingBox2d()).extend((bounds.extmin, bounds.extmax))
    return result


def positive_bounds(bounds, pad):
    x0, y0 = bounds.extmin
    x1, y1 = bounds.extmax
    return (x0 - pad, y0 - pad, max(x1 - x0, 0) + 2 * pad, max(y1 - y0, 0) + 2 * pad)


def convert_scene(dxf_path: Path, output_folder: Path, *, max_entities=5000,
                  max_records=MAX_RECORDS, max_vertices=MAX_VERTICES,
                  max_output_bytes=MAX_OUTPUT_BYTES, web_bundle=None):
    if min(max_entities, max_records, max_vertices, max_output_bytes) <= 0:
        raise ValueError('CAD conversion limits must be positive')
    started = perf_counter()
    timings = {}
    web_bundle = (os.environ.get('TB_CAD_WEB_BUNDLE') == '1') if web_bundle is None else web_bundle
    document = ezdxf.readfile(str(dxf_path))
    timings['readDxfMs'] = (perf_counter() - started) * 1000
    modelspace = document.modelspace()
    if len(modelspace) > max_entities:
        raise SceneLimitError(f'Entity count {len(modelspace)} exceeds max {max_entities}')
    source_hash = os.environ.get('TB_CAD_SOURCE_SHA256') or file_sha256(dxf_path)
    if len(source_hash) != 64 or any(c not in '0123456789abcdef' for c in source_hash):
        raise ValueError('Invalid CAD source SHA-256')
    backend = SceneRecorder(max_records, max_vertices)
    stage = perf_counter()
    frontend = SceneFrontend(CadFontContext(document), backend)
    timings['fontSetupMs'] = (perf_counter() - stage) * 1000
    stage = perf_counter()
    frontend.draw_layout(modelspace)
    timings['recordGeometryMs'] = (perf_counter() - stage) * 1000
    stage = perf_counter()
    paper_layouts = [space.name for space in document.layouts
                     if space.name != 'Model' and any(e.dxftype() != 'VIEWPORT' for e in space)]
    if paper_layouts and len(frontend.warnings) < 100:
        frontend.warnings.append({'handle': '', 'type': 'PAPERSPACE',
                                  'reason': 'Only Model space is imported; paper-space geometry exists in: ' + ', '.join(paper_layouts)[:400]})
    wcs = bounds_by_handle(backend.records)
    output_folder.mkdir(parents=True, exist_ok=True)
    entities_dir = output_folder / 'entities'
    if not web_bundle:
        entities_dir.mkdir(exist_ok=True)
    entities = []
    manifest = {'schemaVersion': SCHEMA_VERSION, 'sceneId': source_hash,
                'preview': None if web_bundle else 'preview.svg', 'entities': entities, 'totalCount': 0,
                'sourceEntityCount': len(modelspace), 'skippedCount': frontend.skipped_count,
                'unrenderedEntityCount': len(modelspace),
                'timings': timings, 'resourceMode': 'inline' if web_bundle else 'files',
                'warnings': frontend.warnings, 'availableLayouts': paper_layouts, 'units': document.header.get('$INSUNITS', 0)}
    if backend.records:
        render_bounds = backend.player().bbox()
        if not all(math.isfinite(v) for v in (*render_bounds.extmin, *render_bounds.extmax)):
            raise ValueError('Non-finite CAD geometry')
        # Nonzero framing also handles drawings consisting solely of horizontal/
        # vertical lines. This frame is fixed for the lifetime of the scene.
        # ezdxf rounds an automatic physical page to 0.1 mm. A zero-size
        # point needs a frame large enough to survive that rounding.
        padding = max(max(render_bounds.size.x, render_bounds.size.y) * 0.01, 0.1)
        frame = BoundingBox2d((render_bounds.extmin - Vec2(padding, padding),
                               render_bounds.extmax + Vec2(padding, padding)))
        root = backend.get_xml_root_element(layout.Page(0, 0), render_box=frame,
                    settings=layout.Settings(fit_page=True, output_coordinate_space=COORDINATE_SPACE))
        root.attrib.pop('width', None)
        root.attrib.pop('height', None)
        # Preserve the renderer's canvas policy, including ACI 7 and true white.
        # A transparent export on an unrelated dashboard theme hides real strokes.
        background = backend.renderer.background
        manifest['backgroundColor'] = background.get('fill')
        background.set('data-cad-background', 'true')
        transformed = bounds_by_handle(backend.records)
        matrix = backend.transformation_matrix
        origin = matrix.transform((0, 0, 0))
        # Read coefficients directly; subtracting two translated basis points
        # loses scale precision for large WCS offsets.
        a, b, c, d = matrix[0, 0], matrix[0, 1], matrix[1, 0], matrix[1, 1]
        x, y, width, height = map(float, root.attrib['viewBox'].split())
        manifest.update({
            'previewViewBox': {'x': x, 'y': y, 'width': width, 'height': height},
            'modelspaceBounds': {'minX': frame.extmin.x, 'maxX': frame.extmax.x,
                                'minY': frame.extmin.y, 'maxY': frame.extmax.y},
            'modelToSvg': [a, b, c, d, origin.x, origin.y],
            'scale': a, 'translateX': origin.x, 'translateY': origin.y, 'yFlip': d < 0,
        })
        written = 0
        canvas_min_x, canvas_min_y, canvas_max_x, canvas_max_y = x, y, x + width, y + height

        def write_svg(path, element):
            nonlocal written
            data = ET.tostring(element, encoding='utf-8')
            written += len(data)
            if written > max_output_bytes:
                raise SceneLimitError(f'CAD SVG output exceeds {max_output_bytes} bytes')
            path.write_bytes(data)
            return data

        for handle, group in backend.renderer.groups.items():
            source = document.entitydb.get(handle)
            if source is None or handle not in wcs or handle not in transformed:
                raise ValueError(f'Unowned CAD drawing primitive: {handle}')
            bb = wcs[handle]
            stroke_pad = max(1.0, backend.renderer.stroke_widths.get(handle, 0) / 2 + 1)
            px, py, pw, ph = positive_bounds(transformed[handle], stroke_pad)
            canvas_min_x, canvas_min_y = min(canvas_min_x, px), min(canvas_min_y, py)
            canvas_max_x, canvas_max_y = max(canvas_max_x, px + pw), max(canvas_max_y, py + ph)
            entity_id = 'cad-' + handle
            entity_root = ET.Element('svg', {
                'xmlns': 'http://www.w3.org/2000/svg',
                'viewBox': f'0 0 {pw} {ph}',
                'data-cad-local-entity': 'true', 'data-cad-entity-id': entity_id,
            })
            local_group = copy.copy(group) if web_bundle else copy.deepcopy(group)
            origin = backend.renderer.origins[handle]
            local_group.set('transform', f'translate({number(origin.x - px)} {number(origin.y - py)})')
            entity_root.append(local_group)
            if web_bundle:
                # One bounded manifest avoids thousands of open/stat/realpath/read
                # operations on Windows and no duplicate preview is serialized.
                data = ET.tostring(entity_root, encoding='utf-8')
                if len(data) > 4 * 1024 * 1024:
                    raise SceneLimitError('A CAD instance exceeds 4 MiB; split this block')
                encoded = base64.b64encode(data).decode('ascii')
                written += len(encoded)
                if written > max_output_bytes:
                    raise SceneLimitError(f'CAD bundle exceeds {max_output_bytes} bytes')
                resource = {'svgBase64': encoded}
            else:
                write_svg(entities_dir / (entity_id + '.svg'), entity_root)
                resource = {'svgFile': f'entities/{entity_id}.svg'}
            entities.append({
                'id': entity_id, 'handle': handle, 'instancePath': ['modelspace', handle],
                'type': source.dxftype(), 'layer': source.dxf.get('layer', '0'),
                'blockName': source.dxf.name if source.dxftype() == 'INSERT' else None,
                **resource,
                'x': bb.extmin.x, 'y': bb.extmin.y, 'width': bb.size.x, 'height': bb.size.y,
                'previewX': px, 'previewY': py, 'previewWidth': pw, 'previewHeight': ph,
            })
        # Include stroke extents in the one global frame; tiny drawings with thick
        # lines otherwise clip even though the entity resource is individually padded.
        width, height = canvas_max_x - canvas_min_x, canvas_max_y - canvas_min_y
        root.set('viewBox', f'{canvas_min_x} {canvas_min_y} {width} {height}')
        for key, value in zip(('x', 'y', 'width', 'height'), (canvas_min_x, canvas_min_y, width, height)):
            background.set(key, str(value))
        manifest['previewViewBox'] = dict(x=canvas_min_x, y=canvas_min_y, width=width, height=height)
        inverse = matrix.copy()
        inverse.inverse()
        bounds = BoundingBox2d([inverse.transform((canvas_min_x, canvas_min_y, 0)),
                               inverse.transform((canvas_max_x, canvas_max_y, 0))])
        manifest['modelspaceBounds'] = dict(minX=bounds.extmin.x, maxX=bounds.extmax.x,
                                          minY=bounds.extmin.y, maxY=bounds.extmax.y)
        if not web_bundle:
            write_svg(output_folder / 'preview.svg', root)
        manifest['totalCount'] = len(entities)
        manifest['renderedPrimitiveCount'] = len(backend.records)
        manifest['unrenderedEntityCount'] = len(modelspace) - len(entities)
    timings['svgAndResourcesMs'] = (perf_counter() - stage) * 1000
    timings['sceneTotalMs'] = (perf_counter() - started) * 1000
    payload = json.dumps(manifest, ensure_ascii=False, allow_nan=False).encode('utf-8')
    if len(payload) > max_output_bytes:
        raise SceneLimitError(f'CAD manifest exceeds {max_output_bytes} bytes')
    (output_folder / 'manifest.json').write_bytes(payload)
    return {'preview': str(output_folder / 'preview.svg') if entities and not web_bundle else None,
            'manifest': str(output_folder / 'manifest.json'),
            'totalCount': len(entities), 'entities': entities}
