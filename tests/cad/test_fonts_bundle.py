# Copyright © 2016-2026 The Thingsboard Authors
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy at http://www.apache.org/licenses/LICENSE-2.0
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
import base64
import json
import sys
from pathlib import Path

import ezdxf
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'application/src/main/data/scripts/cad'))
from cad_fonts import CadFontContext, font_basename, resolve_source_font
from cad_scene import convert_scene, SceneLimitError
from ezdxf.fonts import fonts


@pytest.mark.parametrize('raw', ['romans', 'ROMANS', 'romans.shx', 'C:\\CAD\\Fonts\\romans.shx'])
def test_extensionless_shx_alias_is_exact_when_installed(monkeypatch, raw):
    monkeypatch.setattr(fonts.font_manager, 'has_font', lambda name: name.lower() == 'romans.shx')
    resolved, exact = resolve_source_font(raw)
    assert resolved.lower() == 'romans.shx'
    assert exact


def test_equivalent_ttf_is_not_misreported_as_exact_shx(monkeypatch):
    monkeypatch.setattr(fonts.font_manager, 'has_font', lambda name: name.lower() == 'romans__.ttf')
    assert resolve_source_font('romans') == ('romans__.ttf', False)


def test_missing_fonts_still_produce_scada_vector_paths(tmp_path):
    doc = ezdxf.new(); doc.styles.new('unavailable', dxfattribs={'font': 'not-a-real-font.shx'})
    doc.modelspace().add_text('PUMP 101', dxfattribs={'style': 'unavailable', 'height': 5})
    source = tmp_path / 'source.dxf'; doc.saveas(source)
    convert_scene(source, tmp_path / 'out', web_bundle=True)
    result = json.loads((tmp_path / 'out/manifest.json').read_text())
    assert result['totalCount'] == 1
    assert '<path' in base64.b64decode(result['entities'][0]['svgBase64']).decode()
    assert result['warnings'][0]['type'] == 'FONT'
    assert 'SCADA conversion is available' in result['warnings'][0]['reason']


def test_bundle_and_file_resources_are_identical_and_bounded(tmp_path):
    doc = ezdxf.new(); block = doc.blocks.new('PUMP'); block.add_circle((0, 0), 3)
    for i in range(40):
        doc.modelspace().add_blockref('PUMP', (i * 10, i * 5), dxfattribs={'rotation': i})
    source = tmp_path / 'source.dxf'; doc.saveas(source)
    convert_scene(source, tmp_path / 'files')
    convert_scene(source, tmp_path / 'bundle', web_bundle=True)
    old = json.loads((tmp_path / 'files/manifest.json').read_text())
    new = json.loads((tmp_path / 'bundle/manifest.json').read_text())
    assert old['previewViewBox'] == new['previewViewBox']
    assert old['modelToSvg'] == new['modelToSvg']
    assert len(new['entities']) == 40
    assert len(list((tmp_path / 'bundle').rglob('*'))) == 1
    for previous, current in zip(old['entities'], new['entities']):
        assert previous['id'] == current['id']
        assert (tmp_path / 'files' / previous['svgFile']).read_bytes() == base64.b64decode(current['svgBase64'])
    assert all(value >= 0 for value in new['timings'].values())
    with pytest.raises(SceneLimitError):
        convert_scene(source, tmp_path / 'limited', web_bundle=True, max_output_bytes=100)
    assert not (tmp_path / 'limited/manifest.json').exists()


def test_font_directory_is_operator_configured_not_from_drawing(monkeypatch, tmp_path):
    monkeypatch.setenv('CAD_FONT_DIRS', str(tmp_path / 'missing'))
    with pytest.raises(ValueError, match='CAD_FONT_DIRS'):
        CadFontContext(ezdxf.new())
    assert font_basename('C:\\private\\elsewhere\\txt.shx') == 'txt.shx'


def test_production_java_cache_and_inline_decoder(tmp_path):
    import subprocess
    java = ROOT / 'application/src/main/java/org/thingsboard/server/service/entitiy/cad'
    subprocess.run(['javac', '-d', str(tmp_path), str(java / 'CadResultCache.java'),
                    str(java / 'CadInlineResource.java'), str(ROOT / 'tests/cad/CadCacheRegression.java')], check=True)
    subprocess.run(['java', '-Xmx32m', '-cp', str(tmp_path),
                    'org.thingsboard.server.service.entitiy.cad.CadCacheRegression'], check=True, timeout=30)
