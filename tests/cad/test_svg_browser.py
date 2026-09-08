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
"""Real Chromium regressions for the production CAD scene and import planner.

These are browser helper tests, not a deployed ThingsBoard/ODA end-to-end test.
Set CAD_CHROMIUM_EXECUTABLE to use an installed Chromium instead of Playwright's.
"""
import os
from pathlib import Path
import subprocess

import pytest
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
CAD = ROOT / 'ui-ngx/src/app/modules/home/components/dashboard-page/cad-import-dialog'


def test_styles_do_not_leak_between_entities_or_page(page):
    result = page.evaluate('''() => {
      const svg = showScene(crossing);
      const paths = [...svg.querySelectorAll('path')];
      return {colors: paths.map(path => getComputedStyle(path).stroke),
              rules: svg.querySelectorAll('style').length,
              groups: svg.querySelectorAll('g[data-cad-entity-id]').length};
    }''')
    assert result == {'colors': ['rgb(255, 0, 0)', 'rgb(0, 0, 255)'], 'rules': 0, 'groups': 2}


def test_delete_does_not_paint_over_retained_crossing_and_survives_rebuild(page):
    page.evaluate("showScene(crossing)")
    page.evaluate("document.querySelector('[data-cad-entity-id=horizontal]').remove()")
    after_delete = page.locator('#scene').screenshot()
    page.evaluate("showScene(crossing, ['horizontal'])")
    assert page.locator('#scene').screenshot() == after_delete
    assert page.locator('[data-cad-entity-id=horizontal]').count() == 0
    assert page.locator('[data-cad-deleted-mask-id]').count() == 0
    # Crossing remains blue, including the pixel a bbox white mask would hide.
    assert page.evaluate("getComputedStyle(document.querySelector('path')).stroke") == 'rgb(0, 0, 255)'


def test_preview_and_export_have_identical_pixels_after_delete(page):
    page.evaluate("showScene(crossing, ['horizontal'])")
    preview = page.locator('#scene').screenshot()
    page.evaluate('''() => {
      const output = items(crossing, ['horizontal']);
      const svg = new DOMParser().parseFromString(svgApi.decodeCadSvg(output[0].entity.svgBase64), 'image/svg+xml').documentElement;
      svg.setAttribute('width', '480'); svg.setAttribute('height', '480');
      document.getElementById('scene').replaceChildren(svg);
    }''')
    assert page.locator('#scene').screenshot() == preview


def test_retained_background_uses_global_frame_after_edge_entity_mapping(page):
    result = page.evaluate('''() => {
      const output = items(crossing, [], [['horizontal', {title: 'Live pump'}]]);
      const bg = output[0];
      const svg = new DOMParser().parseFromString(svgApi.decodeCadSvg(bg.entity.svgBase64), 'image/svg+xml');
      return {ids: bg.entityIds, frame: [bg.entity.previewX, bg.entity.previewY, bg.entity.previewWidth, bg.entity.previewHeight],
              vb: svg.documentElement.getAttribute('viewBox'), count: output.length,
              mappedInBackground: svg.querySelectorAll('[data-cad-entity-id=horizontal]').length};
    }''')
    assert result == {'ids': ['vertical'], 'frame': [-10, -10, 120, 120], 'vb': '-10 -10 120 120',
                      'count': 2, 'mappedInBackground': 0}


def test_real_geometry_hit_testing_does_not_select_empty_bbox(page):
    result = page.evaluate('''() => {
      showScene([entity('circle', 'red', '<circle class="C0" cx="50" cy="50" r="30"/>')]);
      return {center: document.elementFromPoint(240, 240)?.closest('[data-cad-entity-id]')?.getAttribute('data-cad-entity-id') ?? null,
              edge: document.elementFromPoint(360, 240)?.closest('[data-cad-entity-id]')?.getAttribute('data-cad-entity-id') ?? null};
    }''')
    assert result == {'center': None, 'edge': 'circle'}


def test_duplicate_defs_ids_are_isolated_and_references_preserved(page):
    result = page.evaluate('''() => {
      const clip = '<clipPath id="clip"><rect x="0" y="0" width="100" height="100"/></clipPath>';
      const geometry = '<path class="C0" clip-path="url(#clip)" d="M 5 50 L 95 50"/>';
      const svg = showScene([entity('a', 'red', geometry, clip), entity('b', 'blue', geometry, clip)]);
      const ids = [...svg.querySelectorAll('[id]')].map(node => node.id);
      return {ids, refs: [...svg.querySelectorAll('path')].map(node => node.getAttribute('clip-path'))};
    }''')
    assert len(result['ids']) == len(set(result['ids'])) == 2
    assert result['refs'] == [f'url(#{identifier})' for identifier in result['ids']]


def test_utf8_and_metadata_are_not_double_encoded(page):
    result = page.evaluate('''() => {
      const text = '<text x="10" y="20">阀门 &amp; 泵站 🔧</text>';
      const output = items([entity('text', 'red', text)]);
      const svg = new DOMParser().parseFromString(svgApi.decodeCadSvg(output[0].entity.svgBase64), 'image/svg+xml');
      return {text: svg.querySelector('text').textContent, metadata: [...svg.querySelectorAll('*')].filter(n => n.localName === 'metadata').length};
    }''')
    assert result == {'text': '阀门 & 泵站 🔧', 'metadata': 0}


@pytest.mark.parametrize('geometry', [
    '<script>alert(1)</script>', '<path onload="alert(1)"/>', '<foreignObject/>',
    '<use href="https://example.invalid/remote.svg#x"/>',
    '<path style="fill:url(https://example.invalid/x)"/>',
    '<style>body { color: red; }</style>', '<style>@import "https://example.invalid/style.css";</style>',
])
def test_rejects_active_external_or_page_targeting_svg(page, geometry):
    message = page.evaluate('''geometry => {
      try { showScene([entity('bad', 'red', geometry)]); return ''; }
      catch (error) { return error.message; }
    }''', geometry)
    assert message
    assert page.locator('#scene svg').count() == 0


def test_missing_invalid_svg_fails_instead_of_silent_blank_success(page):
    for value in ('', 'not-base64', 'PHN2Zz4='):
        assert page.evaluate('''value => {
          try { const e = entity('bad', 'red', ''); e.svgBase64 = value; items([e]); return false; }
          catch { return true; }
        }''', value)


def test_duplicate_and_overlapping_groups_cannot_duplicate_devices(page):
    result = page.evaluate('''() => {
      const group = {id: 'group', entityIds: ['horizontal', 'horizontal', 'vertical'], widgetInfo: {title:'Pump'}};
      const normalized = items(crossing, [], [], [group]);
      let rejected = false;
      try { items(crossing, [], [], [group, {...group, id:'second'}]); } catch { rejected = true; }
      return {ids: normalized[0].entityIds, count: normalized.length, rejected};
    }''')
    assert result == {'ids': ['horizontal', 'vertical'], 'count': 1, 'rejected': True}


def test_all_deleted_produces_no_background_resource(page):
    assert page.evaluate("items(crossing, ['horizontal', 'vertical']).length") == 0


def test_nonzero_root_viewbox_keeps_entity_at_original_position(page):
    result = page.evaluate('''() => {
      const e = entity('offset', 'red', '<path class="C0" d="M 40 60 L 60 60"/>');
      e.svgBase64 = svgApi.encodeCadSvg(svgApi.decodeCadSvg(e.svgBase64).replace('viewBox="0 0 100 100"', 'viewBox="40 50 20 20"'));
      const svg = showScene([e]);
      const box = svg.querySelector('path').getBoundingClientRect();
      return {left: box.left, top: box.top, width: box.width};
    }''')
    assert result == {'left': 200, 'top': 280, 'width': 80}


def test_many_static_entities_still_produce_one_background(page):
    result = page.evaluate('''() => {
      const entities = Array.from({length: 600}, (_, i) => entity('line-' + i, 'red', '<path class="C0" d="M 5 50 L 95 50"/>'));
      const deleted = entities.slice(0, 200).map(e => e.id);
      const output = items(entities, deleted);
      return {widgets: output.length, retained: output[0].entityIds.length};
    }''')
    assert result == {'widgets': 1, 'retained': 400}


def test_converter_assets_preview_export_parity(page, tmp_path):
    """Use this repository's real DXF converter, including its nested SVG assets.

    This test must run in Actions; no proprietary ODA installation is needed.
    It checks the converter/frontend contract, not AutoCAD pixel equivalence.
    """
    import base64
    import importlib.util
    import json
    import ezdxf
    import sys

    source = ROOT / 'application/src/main/data/scripts/cad/dwg_to_svg.py'
    sys.path.insert(0, str(source.parent))
    spec = importlib.util.spec_from_file_location('cad_converter_under_test', source)
    converter = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(converter)
    document = ezdxf.new('R2013')
    document.layers.new('PIPES', dxfattribs={'color': 1})
    modelspace = document.modelspace()
    modelspace.add_line((0, 0), (100, 0), dxfattribs={'layer': 'PIPES'})
    modelspace.add_line((50, -30), (50, 30), dxfattribs={'color': 3})
    modelspace.add_circle((100, 20), 10, dxfattribs={'true_color': 0x0066FF})
    modelspace.add_text('Pump P-101', dxfattribs={'height': 4, 'insert': (20, 50)})
    inner = document.blocks.new('INNER')
    inner.add_circle((0, 0), 5)
    outer = document.blocks.new('PUMP')
    outer.add_blockref('INNER', (0, 0))
    outer.add_line((-10, 0), (10, 0))
    modelspace.add_blockref('PUMP', (20, 30), dxfattribs={'rotation': 30, 'xscale': 2})
    path = tmp_path / 'contract.dxf'
    document.saveas(path)
    output = tmp_path / 'converted'
    converter.dxf_to_per_entity_svgs(path, output, max_entities=100)
    manifest = json.loads((output / 'manifest.json').read_text(encoding='utf-8'))
    assert len(manifest['entities']) == 5
    entities = [{**entry, 'svgBase64': base64.b64encode((output / entry['svgFile']).read_bytes()).decode('ascii')}
                for entry in manifest['entities']]
    page.evaluate('''data => {
      window.frame = data.frame;
      window.convertedEntities = data.entities;
      showScene(convertedEntities, [convertedEntities[0].id]);
    }''', {'frame': manifest['previewViewBox'], 'entities': entities})
    preview = page.locator('#scene').screenshot()
    page.evaluate('''() => {
      const output = items(convertedEntities, [convertedEntities[0].id]);
      const root = new DOMParser().parseFromString(svgApi.decodeCadSvg(output[0].entity.svgBase64), 'image/svg+xml').documentElement;
      root.setAttribute('width', '480'); root.setAttribute('height', '480');
      document.getElementById('scene').replaceChildren(root);
    }''')
    exported = page.locator('#scene').screenshot()
    artifacts = Path(os.environ.get('CAD_TEST_ARTIFACTS', str(tmp_path / 'artifacts')))
    artifacts.mkdir(parents=True, exist_ok=True)
    (artifacts / 'converted-preview.png').write_bytes(preview)
    (artifacts / 'converted-dashboard-background.png').write_bytes(exported)
    assert exported == preview


def test_same_block_instances_delete_save_reload_and_async_export(page):
    result = page.evaluate('''async () => {
      const {CadSceneState} = cadModules['./cad-scene-state'];
      const entities = crossing.map(e => ({...e, type: 'INSERT', blockName: 'PUMP'}));
      const scene = new CadSceneState('a'.repeat(64), entities);
      scene.deleteInstances(['horizontal']);
      const dashboard = JSON.parse(JSON.stringify({configuration: {widgets: {
        background: {config: {cadSceneEdits: scene.snapshot()}}
      }}}));
      const restored = new CadSceneState('a'.repeat(64), entities);
      restored.restore(dashboard.configuration.widgets.background.config.cadSceneEdits);
      const output = await planApi.buildCadImportWidgetItemsAsync({
        entities: restored.keptEntities, deletedEntityIds: restored.deletedEntityIds,
        entityMappings: new Map(), groupMappings: [], previewViewBox: frame, outputMode: 'background'
      });
      const svg = new DOMParser().parseFromString(svgApi.decodeCadSvg(output[0].entity.svgBase64), 'image/svg+xml');
      return {retained: output[0].entityIds, removed: svg.querySelectorAll('[data-cad-entity-id=horizontal]').length,
              instances: svg.querySelectorAll('g[data-cad-entity-id]').length,
              source: entities.map(e => e.id), edits: restored.snapshot()};
    }''')
    assert result['retained'] == ['vertical']
    assert result['removed'] == 0 and result['instances'] == 1
    assert result['source'] == ['horizontal', 'vertical']
    assert result['edits']['deletedEntityIds'] == ['horizontal']


def test_async_preview_export_yields_to_browser_and_preserves_utf8(page, tmp_path):
    import json
    report = page.evaluate('''async () => {
      const entities = Array.from({length: 1500}, (_, i) => entity('instance-' + i, 'red',
          '<text x="5" y="50">阀门🔧</text><path class="C0" d="M 5 50 L 95 50"/>'));
      let ticks = 0;
      const timer = setInterval(() => ticks++, 0);
      const start = performance.now();
      try {
        const scene = await svgApi.buildCadSvgSceneAsync(entities, frame);
        const previewTicks = ticks;
        const output = await planApi.buildCadImportWidgetItemsAsync({
          entities, deletedEntityIds: new Set(), entityMappings: new Map(), groupMappings: [], previewViewBox: frame, outputMode: 'background'
        });
        const xml = new DOMParser().parseFromString(svgApi.decodeCadSvg(output[0].entity.svgBase64), 'image/svg+xml');
        return {entities: scene.querySelectorAll('g[data-cad-entity-id]').length,
                textCount: xml.querySelectorAll('text').length, text: xml.querySelector('text').textContent,
                widgets: output.length, previewTicks, exportTicks: ticks-previewTicks,
                milliseconds: performance.now()-start, userAgent: navigator.userAgent};
      } finally { clearInterval(timer); }
    }''')
    assert report['entities'] == report['textCount'] == 1500
    assert report['text'] == '阀门🔧' and report['widgets'] == 1
    assert report['previewTicks'] > 0 and report['exportTicks'] > 0
    artifact = Path(os.environ.get('CAD_TEST_ARTIFACTS', str(tmp_path)))
    artifact.mkdir(parents=True, exist_ok=True)
    (artifact / 'browser-scene-report.json').write_text(json.dumps(report, indent=2))


@pytest.mark.parametrize('before_start', [True, False])
def test_async_build_cancellation_does_not_attach_partial_scene(page, before_start):
    result = page.evaluate('''async before => {
      const entities = Array.from({length: 1000}, (_, i) => ({...crossing[0], id:'instance-' + i}));
      const controller = new AbortController();
      if (before) controller.abort(); else setTimeout(() => controller.abort(), 0);
      try {
        const scene = await svgApi.buildCadSvgSceneAsync(entities, frame, new Set(), {signal:controller.signal});
        document.getElementById('scene').replaceChildren(scene);
        return 'not aborted';
      } catch(error) { return error.name; }
    }''', before_start)
    assert result == 'AbortError'
    assert page.locator('#scene svg').count() == 0
