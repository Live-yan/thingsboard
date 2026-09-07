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
import importlib.util
import json
import os
from pathlib import Path
import sys
import time
import xml.etree.ElementTree as ET

import ezdxf
import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / 'application/src/main/data/scripts/cad'
sys.path.insert(0, str(SCRIPTS))
from cad_scene import convert_scene, SceneLimitError


def run_scene(document, tmp_path, **limits):
    source = tmp_path / 'source.dxf'
    document.saveas(source)
    convert_scene(source, tmp_path / 'out', **limits)
    return json.loads((tmp_path / 'out/manifest.json').read_text())


def test_nested_instances_own_their_attributes_and_keep_original_layer_color(tmp_path):
    document = ezdxf.new('R2013')
    document.layers.new('PUMP', dxfattribs={'color': 1})
    inner = document.blocks.new('INNER')
    inner.add_circle((0, 0), 5)
    outer = document.blocks.new('PUMP')
    outer.add_blockref('INNER', (0, 0))
    outer.add_attdef('TAG', (0, 0), height=1)
    first = document.modelspace().add_blockref('PUMP', (0, 0), dxfattribs={'layer': 'PUMP', 'rotation': 30})
    first.add_auto_attribs({'TAG': 'P-101'})
    second = document.modelspace().add_blockref('PUMP', (100, 0), dxfattribs={'color': 3, 'xscale': -1})
    second.add_auto_attribs({'TAG': 'P-102'})
    manifest = run_scene(document, tmp_path)
    assert {e['id'] for e in manifest['entities']} == {'cad-' + first.dxf.handle, 'cad-' + second.dxf.handle}
    assert len(manifest['entities']) == 2  # ATTRIBs and nested INSERTs are not separate instances
    preview = ET.parse(tmp_path / 'out/preview.svg').getroot()
    groups = [node for node in preview.iter() if node.get('data-cad-entity-id')]
    assert len(groups) == 2
    for group, entity in zip(groups, manifest['entities']):
        asset = ET.parse(tmp_path / 'out' / entity['svgFile']).getroot()
        owned = next(node for node in asset if node.tag.endswith('g'))
        assert ET.tostring(group) == ET.tostring(owned)
        assert len(list(group)) > 1  # circle and actual attribute glyph paths
    assert any(node.get('stroke') == '#ff0000' for node in groups[0].iter())
    assert document.blocks.get('PUMP').is_alive  # conversion never modifies the source definition


def test_handles_stay_stable_and_source_hash_changes_when_source_changes(tmp_path):
    document = ezdxf.new()
    original = document.modelspace().add_circle((0, 0), 2)
    first = run_scene(document, tmp_path)
    document.modelspace().add_line((10, 0), (20, 0))
    second = run_scene(document, tmp_path)
    assert first['entities'][0]['id'] == 'cad-' + original.dxf.handle
    assert first['entities'][0]['id'] in {e['id'] for e in second['entities']}
    assert first['sceneId'] != second['sceneId']


def test_actual_matrix_maps_recorded_wcs_bounds_into_preview(tmp_path):
    document = ezdxf.new()
    document.modelspace().add_line((-1000, 200), (1000, 200))
    document.modelspace().add_circle((100, -200), 10)
    manifest = run_scene(document, tmp_path)
    a, b, c, d, tx, ty = manifest['modelToSvg']
    assert b == c == 0
    assert a > 0 and d < 0
    assert manifest['scale'] == a
    for entity in manifest['entities']:
        points = [(entity['x'], entity['y']), (entity['x']+entity['width'], entity['y']+entity['height'])]
        for x, y in points:
            sx, sy = a*x+c*y+tx, b*x+d*y+ty
            assert entity['previewX'] <= sx <= entity['previewX']+entity['previewWidth']
            assert entity['previewY'] <= sy <= entity['previewY']+entity['previewHeight']


@pytest.mark.parametrize('shape', ['horizontal', 'vertical', 'point'])
def test_degenerate_drawings_get_finite_nonzero_frames(tmp_path, shape):
    document = ezdxf.new()
    if shape == 'point': document.modelspace().add_point((5, 5))
    else: document.modelspace().add_line((0, 0), (10, 0) if shape == 'horizontal' else (0, 10))
    manifest = run_scene(document, tmp_path)
    assert manifest['previewViewBox']['width'] > 0
    assert manifest['previewViewBox']['height'] > 0
    assert len(manifest['entities']) == 1


@pytest.mark.parametrize('limit', [{'max_entities': 1}, {'max_records': 1}, {'max_vertices': 1}, {'max_output_bytes': 1}])
def test_complexity_limits_fail_instead_of_silent_partial_success(tmp_path, limit):
    document = ezdxf.new()
    document.modelspace().add_line((0, 0), (1, 1))
    document.modelspace().add_line((0, 1), (1, 0))
    with pytest.raises(SceneLimitError): run_scene(document, tmp_path, **limit)
    assert not (tmp_path / 'out/manifest.json').exists()


def test_cyclic_blocks_are_bounded(tmp_path):
    document = ezdxf.new()
    a = document.blocks.new('A')
    b = document.blocks.new('B')
    a.add_blockref('B', (0, 0))
    b.add_blockref('A', (0, 0))
    document.modelspace().add_blockref('A', (0, 0))
    with pytest.raises(SceneLimitError, match='nesting'): run_scene(document, tmp_path)


def test_uploaded_source_fingerprint_is_carried_through_dwg_conversion(tmp_path, monkeypatch):
    monkeypatch.setenv('TB_CAD_SOURCE_SHA256', 'a' * 64)
    document = ezdxf.new()
    document.modelspace().add_line((0, 0), (1, 1))
    assert run_scene(document, tmp_path)['sceneId'] == 'a' * 64


def test_large_dxf_and_5000_entity_conversion_report(tmp_path):
    document = ezdxf.new('R2013')
    for i in range(5000):
        document.modelspace().add_line((i % 100, i // 100), (i % 100 + .5, i // 100 + .5))
    source = tmp_path / 'large.dxf'
    document.saveas(source)
    content = source.read_bytes()
    marker = b'ENTITIES\n'
    if marker not in content: marker = b'ENTITIES\r\n'
    split = content.index(marker) + len(marker)
    comment = b'999\n' + b'x' * 1024 + b'\n'
    with source.open('wb') as output:
        output.write(content[:split])
        for _ in range((64 * 1024 * 1024) // len(comment) + 1): output.write(comment)
        output.write(content[split:])
    started = time.perf_counter()
    result = convert_scene(source, tmp_path / 'out', max_entities=5000)
    elapsed = time.perf_counter() - started
    assert result['totalCount'] == 5000
    assert elapsed < 60  # gross regression guard, not a production latency SLA
    report = {'inputBytes': source.stat().st_size, 'entities': result['totalCount'], 'seconds': elapsed,
              'outputBytes': sum(p.stat().st_size for p in (tmp_path / 'out').rglob('*') if p.is_file()),
              'ezdxf': ezdxf.__version__, 'python': sys.version.split()[0],
              'dataset': 'synthetic DXF, 64 MiB comments plus 5000 LINE instances; not an arbitrary real drawing'}
    artifact = Path(os.environ.get('CAD_TEST_ARTIFACTS', str(tmp_path)))
    artifact.mkdir(parents=True, exist_ok=True)
    (artifact / 'large-cad-report.json').write_text(json.dumps(report, indent=2))
