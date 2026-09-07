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
"""Independent geometry/reference checks, not only preview == export comparisons."""
import base64
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET

import ezdxf
import numpy as np
from PIL import Image
import pytest

from test_canonical_scene import run_scene
from cad_scene import convert_scene, SceneLimitError

ROOT = Path(__file__).resolve().parents[2]
SCADA = ROOT / 'ui-ngx/src/app/modules/home/components/widget/lib/scada'


def paths(tmp_path, entry):
    return [node for node in ET.parse(tmp_path / 'out' / entry['svgFile']).iter() if node.tag.endswith('path')]


def test_large_extent_line_and_subunit_circle_retain_visible_stroke_and_geometry(tmp_path, page):
    doc = ezdxf.new()
    doc.modelspace().add_line((0, 0), (10_000_000, 10_000_000))
    doc.modelspace().add_circle((100, 100), .01)
    manifest = run_scene(doc, tmp_path)
    a, b, c, d, tx, ty = manifest['modelToSvg']
    for entry in manifest['entities']:
        assert all(float(node.get('stroke-width', '0')) > 0 for node in paths(tmp_path, entry))
    circle = next(e for e in manifest['entities'] if e['type'] == 'CIRCLE')
    # Measure actual path geometry in Chromium, against analytic CAD radius.
    svg = (tmp_path / 'out' / circle['svgFile']).read_text()
    measured = page.evaluate("""svg => {
      document.getElementById('scene').innerHTML = svg;
      const path = document.querySelector('path'); const box = path.getBBox();
      return {width:box.width,height:box.height};
    }""", svg)
    # Local-coordinate resources also survive Chromium's float32 path geometry,
    # not merely the text serialization of small numbers at global ~100k offsets.
    assert measured['width'] == pytest.approx(.02 * abs(a), rel=.001)
    assert measured['height'] == pytest.approx(.02 * abs(d), rel=.001)
    assert 'C ' in paths(tmp_path, circle)[0].get('d')
    coords = paths(tmp_path, circle)[0].get('d')
    assert 'C 0 0 0 0 0 0' not in coords
    assert abs(abs(a) - abs(d)) < 1e-8


def test_fractional_polyline_does_not_accumulate_rounding_error():
    from cad_svg_precision import PrecisionSvgRenderer
    from ezdxf.math import Vec2
    points = [Vec2(i * .49, i * .23) for i in range(2001)]
    renderer = object.__new__(PrecisionSvgRenderer)
    data = renderer.make_polyline_str(points)
    assert data.endswith('L 980 460')
    assert data.count('L ') == 2000
    assert 'L 0.49 0.23' in data


def test_fractional_curve_matches_analytic_circle_in_browser(page):
    from cad_svg_precision import PrecisionSvgRenderer
    from ezdxf.addons.drawing.backend import BkPath2d
    from ezdxf.path import make_path
    doc = ezdxf.new(); e = doc.modelspace().add_circle((1, 1), .04)
    renderer = object.__new__(PrecisionSvgRenderer)
    data = renderer.make_path_str(BkPath2d(make_path(e)))
    measured = page.evaluate("""d => {
      document.getElementById('scene').innerHTML = '<svg><path/></svg>';
      const path = document.querySelector('path'); path.setAttribute('d', d);
      const box = path.getBBox(); return {width:box.width,height:box.height,length:path.getTotalLength()};
    }""", data)
    assert measured['width'] == pytest.approx(.08, abs=1e-6)
    assert measured['height'] == pytest.approx(.08, abs=1e-6)
    assert measured['length'] == pytest.approx(2 * np.pi * .04, rel=.001)


def test_original_background_and_true_white_are_preserved(tmp_path):
    doc = ezdxf.new()
    doc.modelspace().add_line((0, 0), (100, 0), dxfattribs={'true_color':0xFFFFFF})
    manifest = run_scene(doc, tmp_path)
    assert manifest['backgroundColor'] != '#ffffff'
    root = ET.parse(tmp_path/'out/preview.svg').getroot()
    bg = next(n for n in root if n.get('data-cad-background'))
    assert bg.get('fill') == manifest['backgroundColor']
    assert paths(tmp_path, manifest['entities'][0])[0].get('stroke') == '#ffffff'


def test_thick_strokes_are_inside_global_frame(tmp_path):
    doc = ezdxf.new()
    doc.modelspace().add_line((0,0), (.01,0), dxfattribs={'lineweight':211})
    m = run_scene(doc,tmp_path); box = m['previewViewBox']; e=m['entities'][0]
    assert box['x'] <= e['previewX'] and box['y'] <= e['previewY']
    assert box['x']+box['width'] >= e['previewX']+e['previewWidth']
    assert box['y']+box['height'] >= e['previewY']+e['previewHeight']


def test_external_images_xrefs_and_paperspace_are_reported(tmp_path):
    doc = ezdxf.new(); m = doc.modelspace(); m.add_line((0,0),(1,1))
    image = doc.add_image_def('missing.png', (10,10))
    m.add_image(image, (20,20), (10,10))
    doc.add_xref_def('missing.dxf', 'external'); m.add_blockref('external',(40,40))
    doc.layouts.get('Layout1').add_line((0,0),(1,1))
    result=run_scene(doc,tmp_path)
    assert {'IMAGE','INSERT','PAPERSPACE'} <= {w['type'] for w in result['warnings']}
    assert result['skippedCount'] == 2
    assert result['totalCount'] == 1


def test_hatch_timeout_or_density_never_returns_partial_success(tmp_path, monkeypatch):
    from cad_scene import hatching
    doc=ezdxf.new(); h=doc.modelspace().add_hatch()
    h.paths.add_polyline_path([(0,0),(10,0),(10,10),(0,10)], is_closed=True)
    h.set_pattern_fill('ANSI31', scale=.1)
    def fail(*args, **kwargs):
        raise hatching.DenseHatchingLinesError()
    monkeypatch.setattr(hatching, 'pattern_baselines', fail)
    with pytest.raises(SceneLimitError, match='dense'): run_scene(doc,tmp_path)
    assert not (tmp_path/'out/manifest.json').exists()


def test_pattern_lines_are_recorded_in_bounded_chunks(tmp_path, monkeypatch):
    from cad_scene import SceneRecorder
    from ezdxf.addons.drawing import recorder
    sizes=[]; original=SceneRecorder.store
    def store(self, record, properties):
        if isinstance(record,recorder.SolidLinesRecord): sizes.append(len(record.lines))
        return original(self,record,properties)
    monkeypatch.setattr(SceneRecorder,'store',store)
    doc=ezdxf.new(); h=doc.modelspace().add_hatch()
    h.paths.add_polyline_path([(0,0),(100,0),(100,100),(0,100)], is_closed=True)
    h.set_pattern_fill('ANSI31', scale=.01)
    run_scene(doc,tmp_path)
    assert sizes and max(sizes) <= 2048  # record stores two vertices per segment


@pytest.fixture(scope='session')
def runtime_module(tmp_path_factory):
    out=tmp_path_factory.mktemp('scada-runtime')
    subprocess.run(['tsc','--strict','--target','es2020','--module','commonjs','--lib','es2020,dom',
                    '--outDir',str(out),str(SCADA/'scada-svg-document.ts')],check=True)
    return (out/'scada-svg-document.js').read_text()


def load_runtime(page,runtime_module):
    page.add_script_tag(content='window.runtime = {}; (function(exports){'+runtime_module+'})(runtime);')


def test_runtime_preserves_root_properties_and_exact_id_references(page,runtime_module):
    load_runtime(page,runtime_module)
    result=page.evaluate("""() => {
      const doc=new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 100 50"
        data-cad-scene="true" fill="red" fill-rule="evenodd" stroke-width="2">
        <defs><clipPath id="clip"><rect width="100" height="100"/></clipPath>
        <clipPath id="clip-long"><rect width="100" height="100"/></clipPath></defs>
        <path id="shape" clip-path="url(#clip-long)" d="M 10 20 L 40 20 L 20 40 Z"/>
        </svg>`, 'image/svg+xml');
      const root=runtime.prepareScadaSvgDocument(doc,'instance');
      document.getElementById('scene').replaceChildren(root);
      return {fill:getComputedStyle(root.querySelector('path')).fill, vb:root.getAttribute('viewBox'),
        clip:root.querySelector('path').getAttribute('clip-path'), aspect:runtime.scadaSvgAspectRatio(root,true),
        source:doc.querySelector('path').id};
    }""")
    assert result=={'fill':'rgb(255, 0, 0)','vb':'10 20 100 50','clip':'url(#clip-long_instance)',
                   'aspect':'xMidYMid meet','source':'shape'}


def test_resource_roundtrip_through_runtime_does_not_stretch_circle(page,runtime_module):
    load_runtime(page,runtime_module)
    result=page.evaluate("""async () => {
      const e=entity('circle','white','<circle class="C0" cx="50" cy="50" r="25"/>');
      const saved=await svgApi.buildCadSvgBase64Async([e],frame,{backgroundColor:'#212830'});
      const root=runtime.prepareScadaSvgDocument(new DOMParser().parseFromString(svgApi.decodeCadSvg(saved),'image/svg+xml'),'reload');
      root.setAttribute('width','600');root.setAttribute('height','150');
      root.setAttribute('preserveAspectRatio',runtime.scadaSvgAspectRatio(root,true));
      document.getElementById('scene').replaceChildren(root);
      const bounds=root.querySelector('circle').getBoundingClientRect();
      return {width:bounds.width,height:bounds.height,bg:root.querySelector('[data-cad-background]').getAttribute('fill')};
    }""")
    assert result['width']==result['height']==62.5
    assert result['bg']=='#212830'


def test_direct_ezdxf_reference_vs_saved_background_and_runtime(page,tmp_path,runtime_module):
    """Independent unmodified ezdxf SVG backend reference for a supported 2D fixture.
    This is not an AutoCAD reference or a deployed ThingsBoard HTTP test.
    """
    from ezdxf.addons.drawing import Frontend, RenderContext, svg, layout
    from ezdxf.addons.drawing.config import Configuration
    from ezdxf.math import BoundingBox2d
    load_runtime(page,runtime_module)
    doc=ezdxf.new('R2013'); m=doc.modelspace()
    doc.layers.new('RED',dxfattribs={'color':1})
    m.add_circle((20,30),15,dxfattribs={'layer':'RED'})
    m.add_ellipse((70,30),(20,5),ratio=.3,dxfattribs={'color':3})
    m.add_lwpolyline([(0,0,0,0,.6),(100,0,0,0,0)],format='xyseb',dxfattribs={'color':5})
    m.add_spline([(0,60),(30,75),(60,45),(100,60)])
    m.add_text('PUMP P-101',dxfattribs={'height':4,'insert':(0,90),'rotation':10})
    h=m.add_hatch(color=2);h.paths.add_polyline_path([(110,0),(150,0),(150,40),(110,40)],is_closed=True)
    h.paths.add_polyline_path([(120,10),(140,10),(140,30),(120,30)],is_closed=True,flags=0)
    b=doc.blocks.new('PUMP');b.add_circle((0,0),5);b.add_line((-10,0),(10,0))
    m.add_blockref('PUMP',(110,65),dxfattribs={'rotation':30,'xscale':-2,'yscale':1})
    dim=m.add_linear_dim(base=(0,-20),p1=(0,0),p2=(100,0));dim.render()
    manifest=run_scene(doc,tmp_path)
    assert manifest['totalCount']==len(m)
    # Reference uses the independent library renderer, never our per-entity assets.
    backend=svg.SVGBackend();Frontend(RenderContext(doc),backend,config=Configuration()).draw_layout(m)
    f=manifest['modelspaceBounds']; framebox=BoundingBox2d([(f['minX'],f['minY']),(f['maxX'],f['maxY'])])
    ref=backend.get_string(layout.Page(0,0),render_box=framebox,settings=layout.Settings(output_coordinate_space=100000))
    def screenshot(source):
        page.evaluate("""source => {
          const root=new DOMParser().parseFromString(source,'image/svg+xml').documentElement;
          root.setAttribute('width','800');root.setAttribute('height','500');
          document.getElementById('scene').replaceChildren(root);
        }""",source)
        return page.locator('#scene').screenshot()
    reference=screenshot(ref)
    entities=[{**e,'svgBase64':base64.b64encode((tmp_path/'out'/e['svgFile']).read_bytes()).decode()} for e in manifest['entities']]
    runtime_svg=page.evaluate("""async data => {
      const base64=await svgApi.buildCadSvgBase64Async(data.entities,data.frame,{backgroundColor:data.background});
      const prepared=runtime.prepareScadaSvgDocument(new DOMParser().parseFromString(svgApi.decodeCadSvg(base64),'image/svg+xml'),'saved');
      prepared.setAttribute('preserveAspectRatio',runtime.scadaSvgAspectRatio(prepared,true));
      return new XMLSerializer().serializeToString(prepared);
    }""",{'entities':entities,'frame':manifest['previewViewBox'],'background':manifest['backgroundColor']})
    actual=screenshot(runtime_svg)
    a=np.array(Image.open(io.BytesIO(reference)).convert('RGB')).astype(int)
    b=np.array(Image.open(io.BytesIO(actual)).convert('RGB')).astype(int)
    changed=np.max(np.abs(a-b),axis=2)>24
    ratio=float(changed.mean())
    # Fractional vs integer antialiasing differs on boundaries; missing objects,
    # changed background, swapped colors or nonuniform scaling exceed this bound.
    assert ratio < .01, ratio
    assert np.count_nonzero(np.max(a,axis=2)-np.min(a,axis=2)>80)>500
    artifacts=Path(os.environ.get('CAD_TEST_ARTIFACTS',str(tmp_path)));artifacts.mkdir(parents=True,exist_ok=True)
    (artifacts/'fidelity-reference.png').write_bytes(reference)
    (artifacts/'fidelity-runtime.png').write_bytes(actual)
    (artifacts/'fidelity-pixel-report.json').write_text(json.dumps({'changedPixelRatio':ratio,'threshold':.01,
       'reference':'unmodified ezdxf 1.4.4 SVG backend; NOT AutoCAD','entities':len(entities)},indent=2))


def test_missing_source_font_is_reported_instead_of_claiming_exact_text(tmp_path):
    doc=ezdxf.new();doc.styles.new('SOURCE_FONT',dxfattribs={'font':'absent-cad-test-font.shx'})
    doc.modelspace().add_text('P-101',dxfattribs={'style':'SOURCE_FONT','height':2})
    result=run_scene(doc,tmp_path)
    assert result['totalCount']==1
    assert any(w['type']=='FONT' and 'absent-cad-test-font.shx' in w['reason'] for w in result['warnings'])


def test_hatch_timeout_aborts_without_exporting_partial_geometry(tmp_path, monkeypatch):
    import types
    import cad_scene
    ticks=iter([0,10])
    monkeypatch.setattr(cad_scene,'time',types.SimpleNamespace(monotonic=lambda: next(ticks)))
    doc=ezdxf.new();h=doc.modelspace().add_hatch()
    h.paths.add_polyline_path([(0,0),(10,0),(10,10),(0,10)],is_closed=True)
    h.set_pattern_fill('ANSI31',scale=.1)
    with pytest.raises(SceneLimitError,match='timed out'): run_scene(doc,tmp_path)
    assert not (tmp_path/'out/manifest.json').exists()


def test_populated_xref_geometry_is_not_silently_discarded(tmp_path):
    doc=ezdxf.new();doc.add_xref_def('external.dxf','LOADED')
    block=doc.blocks.get('LOADED')
    block.add_circle((0,0),5)
    doc.modelspace().add_blockref('LOADED',(100,100))
    assert run_scene(doc,tmp_path)['totalCount']==1


def test_geometry_heavy_nested_blocks_performance_report(tmp_path):
    import time
    doc=ezdxf.new('R2013'); child=doc.blocks.new('VALVE')
    for i in range(24): child.add_line((i,0),(i,10))
    for i in range(4): child.add_circle((i*6,15),2)
    child.add_spline([(0,20),(8,23),(16,17),(24,20)])
    h=child.add_hatch(color=2);h.paths.add_polyline_path([(0,25),(24,25),(24,28),(0,28)],is_closed=True)
    parent=doc.blocks.new('ASSEMBLY');parent.add_blockref('VALVE',(0,0));parent.add_line((-2,-2),(26,30))
    for i in range(1000):
        doc.modelspace().add_blockref('ASSEMBLY',((i%40)*40,(i//40)*40),dxfattribs={'rotation':i%4*90,'xscale':-1 if i%2 else 1})
    source=tmp_path/'geometry-heavy.dxf';doc.saveas(source)
    started=time.perf_counter();convert_scene(source,tmp_path/'out');elapsed=time.perf_counter()-started
    report=json.loads((tmp_path/'out/manifest.json').read_text())
    assert report['totalCount']==1000
    assert report['renderedPrimitiveCount']>=30000
    assert elapsed<60  # gross regression budget, not a promised production SLA
    artifacts=Path(os.environ.get('CAD_TEST_ARTIFACTS',str(tmp_path)));artifacts.mkdir(parents=True,exist_ok=True)
    (artifacts/'geometry-heavy-report.json').write_text(json.dumps({'seconds':elapsed,'sourceBytes':source.stat().st_size,
      'instances':report['totalCount'],'primitives':report['renderedPrimitiveCount'],
      'outputBytes':sum(p.stat().st_size for p in (tmp_path/'out').rglob('*') if p.is_file()),
      'dataset':'1000 nested INSERTs, 31k primitives, curves/hatch/rotation/mirror, no comment padding; synthetic, not real DWG'},indent=2))
