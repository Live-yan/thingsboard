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

import copy
import hashlib
import json
import math
import os
import re
from pathlib import Path
import xml.etree.ElementTree as ET

import ezdxf
from ezdxf.addons.drawing import Frontend, RenderContext, layout, svg, recorder
from ezdxf.addons.drawing.config import BackgroundPolicy, Configuration, ImagePolicy
from ezdxf.math import BoundingBox2d, Vec2

SCHEMA_VERSION = 2
COORDINATE_SPACE = 100_000
MAX_RECORDS = 200_000
MAX_VERTICES = 2_000_000
MAX_NESTING = 32
MAX_OUTPUT_BYTES = 128 * 1024 * 1024


class SceneLimitError(ValueError):
    """Fail explicitly rather than silently dropping part of a complex drawing."""


class SceneRenderer(svg.SVGRenderBackend):
    def __init__(self, page, settings):
        super().__init__(page, settings)
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
            })
            self.groups[handle] = group
        return self.groups[handle]

    def add_strokes(self, d, properties):
        if not d:
            return
        color, opacity = self.resolve_color(properties.color)
        width = self.resolve_stroke_width(properties.lineweight)
        self.stroke_widths[properties.handle] = max(width, self.stroke_widths.get(properties.handle, 0))
        ET.SubElement(self.group(properties), 'path', {
            'd': d, 'fill': 'none', 'stroke': color,
            'stroke-opacity': str(opacity), 'stroke-width': str(width),
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
        self.renderer = SceneRenderer(page, settings)
        return self.renderer


class SceneFrontend(Frontend):
    def __init__(self, ctx, backend):
        super().__init__(ctx, backend, config=Configuration(
            background_policy=BackgroundPolicy.WHITE,
            image_policy=ImagePolicy.IGNORE,
            hatching_timeout=5.0,
        ))
        self.scene_backend = backend
        self.depth = 0
        self.skipped_count = 0
        self.warnings = []

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
            super().draw_entity(entity, properties)
        finally:
            self.depth -= 1

    def skip_entity(self, entity, reason):
        self.skipped_count += 1
        if len(self.warnings) < 100:
            self.warnings.append({'handle': entity.dxf.get('handle', ''),
                                  'type': entity.dxftype(), 'reason': str(reason)})


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
                  max_output_bytes=MAX_OUTPUT_BYTES):
    if min(max_entities, max_records, max_vertices, max_output_bytes) <= 0:
        raise ValueError('CAD conversion limits must be positive')
    document = ezdxf.readfile(str(dxf_path))
    modelspace = document.modelspace()
    if len(modelspace) > max_entities:
        raise SceneLimitError(f'Entity count {len(modelspace)} exceeds max {max_entities}')
    source_hash = os.environ.get('TB_CAD_SOURCE_SHA256') or file_sha256(dxf_path)
    if len(source_hash) != 64 or any(c not in '0123456789abcdef' for c in source_hash):
        raise ValueError('Invalid CAD source SHA-256')
    backend = SceneRecorder(max_records, max_vertices)
    frontend = SceneFrontend(RenderContext(document), backend)
    frontend.draw_layout(modelspace)
    wcs = bounds_by_handle(backend.records)
    output_folder.mkdir(parents=True, exist_ok=True)
    entities_dir = output_folder / 'entities'
    entities_dir.mkdir(exist_ok=True)
    entities = []
    manifest = {'schemaVersion': SCHEMA_VERSION, 'sceneId': source_hash,
                'preview': 'preview.svg', 'entities': entities, 'totalCount': 0,
                'sourceEntityCount': len(modelspace), 'skippedCount': frontend.skipped_count,
                'unrenderedEntityCount': len(modelspace),
                'warnings': frontend.warnings, 'units': document.header.get('$INSUNITS', 0)}
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
        # Only the backend-created background is removed, never a CAD primitive.
        root.remove(backend.renderer.background)
        transformed = bounds_by_handle(backend.records)
        matrix = backend.transformation_matrix
        origin = matrix.transform((0, 0, 0))
        ex = matrix.transform((1, 0, 0))
        ey = matrix.transform((0, 1, 0))
        a, b, c, d = ex.x-origin.x, ex.y-origin.y, ey.x-origin.x, ey.y-origin.y
        x, y, width, height = map(float, root.attrib['viewBox'].split())
        manifest.update({
            'previewViewBox': {'x': x, 'y': y, 'width': width, 'height': height},
            'modelspaceBounds': {'minX': frame.extmin.x, 'maxX': frame.extmax.x,
                                'minY': frame.extmin.y, 'maxY': frame.extmax.y},
            'modelToSvg': [a, b, c, d, origin.x, origin.y],
            'scale': a, 'translateX': origin.x, 'translateY': origin.y, 'yFlip': d < 0,
        })
        written = 0

        def write_svg(path, element):
            nonlocal written
            data = ET.tostring(element, encoding='utf-8')
            written += len(data)
            if written > max_output_bytes:
                raise SceneLimitError(f'CAD SVG output exceeds {max_output_bytes} bytes')
            path.write_bytes(data)

        for handle, group in backend.renderer.groups.items():
            source = document.entitydb.get(handle)
            if source is None or handle not in wcs or handle not in transformed:
                raise ValueError(f'Unowned CAD drawing primitive: {handle}')
            bb = wcs[handle]
            stroke_pad = max(1.0, backend.renderer.stroke_widths.get(handle, 0) / 2 + 1)
            px, py, pw, ph = positive_bounds(transformed[handle], stroke_pad)
            entity_id = 'cad-' + handle
            entity_root = ET.Element('svg', {
                'xmlns': 'http://www.w3.org/2000/svg',
                'viewBox': f'{px} {py} {pw} {ph}',
                'data-cad-global-entity': 'true', 'data-cad-entity-id': entity_id,
            })
            entity_root.append(copy.deepcopy(group))
            write_svg(entities_dir / (entity_id + '.svg'), entity_root)
            entities.append({
                'id': entity_id, 'handle': handle, 'instancePath': ['modelspace', handle],
                'type': source.dxftype(), 'layer': source.dxf.get('layer', '0'),
                'blockName': source.dxf.name if source.dxftype() == 'INSERT' else None,
                'svgFile': f'entities/{entity_id}.svg',
                'x': bb.extmin.x, 'y': bb.extmin.y, 'width': bb.size.x, 'height': bb.size.y,
                'previewX': px, 'previewY': py, 'previewWidth': pw, 'previewHeight': ph,
            })
        write_svg(output_folder / 'preview.svg', root)
        manifest['totalCount'] = len(entities)
        manifest['renderedPrimitiveCount'] = len(backend.records)
        manifest['unrenderedEntityCount'] = len(modelspace) - len(entities)
    (output_folder / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, allow_nan=False), encoding='utf-8')
    return {'preview': str(output_folder / 'preview.svg') if entities else None,
            'manifest': str(output_folder / 'manifest.json'),
            'totalCount': len(entities), 'entities': entities}
