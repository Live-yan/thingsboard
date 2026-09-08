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
import json
import os
from pathlib import Path


def setup_source(page):
    page.evaluate("""() => {
      window.originalEntity = entity('pump', '#ffffff',
        '<rect id="real-equipment" x="4" y="4" width="12" height="12" fill="black"/>' +
        '<path id="white-line" class="C0" d="M 10 35 L 90 35"/>' +
        '<path id="white-text-outline" fill="#fff" d="M 30 50 L 35 60 L 25 60 Z"/>' +
        '<path id="red-line" d="M 10 70 L 90 70" fill="none" stroke="red" stroke-width="4"/>' +
        '<path id="yellow-line" d="M 10 85 L 90 85" fill="none" stroke="#ffff00" stroke-width="4"/>');
      window.settings = {mode:'remove',canvasColor:'#ffffff'};
      window.paintOf = node => node.style.stroke || node.getAttribute('stroke');
      window.show = svg => {
        svg.setAttribute('width','480');svg.setAttribute('height','480');
        document.getElementById('scene').replaceChildren(svg);
        return svg;
      };
    }""")


def test_keep_background_preserves_source_white_lines_and_colors(page):
    setup_source(page)
    result = page.evaluate("""() => {
      const svg=show(svgApi.buildCadSvgScene([originalEntity],frame,new Set(),{backgroundColor:'#000000',background:{...settings,mode:'preserve'}}));
      return {background:svg.querySelector('[data-cad-background]').getAttribute('fill'),
        strokes:[...svg.querySelectorAll('path')].map(paintOf),count:svg.querySelectorAll('[data-cad-entity-id]').length};
    }""")
    assert result['background'] == '#000000'
    assert result['strokes'][0] == 'rgb(255, 255, 255)'
    assert result['strokes'][2:] == ['red', '#ffff00']
    assert result['count'] == 1


def test_remove_background_adapts_white_preserves_entities_geometry_and_source(page):
    setup_source(page)
    result = page.evaluate("""() => {
      const original=originalEntity.svgBase64;
      const keep=svgApi.buildCadSvgScene([originalEntity],frame,new Set(),{backgroundColor:'#000000'});
      const svg=show(svgApi.buildCadSvgScene([originalEntity],frame,new Set(),{backgroundColor:'#000000',background:settings}));
      const paths=[...svg.querySelectorAll('path')];
      return {background:svg.querySelectorAll('[data-cad-background]').length,sourceUnchanged:original === originalEntity.svgBase64,
        strokes:paths.map(paintOf),text:paths[1].getAttribute('fill'),rects:svg.querySelectorAll('rect').length,
        rect:svg.querySelector('rect').getAttribute('fill'),
        geometry:paths.map(p=>p.getAttribute('d')),originalGeometry:[...keep.querySelectorAll('path')].map(p=>p.getAttribute('d'))};
    }""")
    assert result['background'] == 0 and result['sourceUnchanged']
    assert result['strokes'][0] == result['text'] == '#30343b'
    assert result['strokes'][2] == 'red'
    assert result['strokes'][3] != '#ffff00'
    assert result['rects'] == 1 and result['rect'] == 'black'
    assert result['geometry'] == result['originalGeometry']


def test_preview_individual_group_merged_resources_share_same_color_policy(page):
    setup_source(page)
    result = page.evaluate("""async () => {
      const e2={...originalEntity,id:'second'};
      const base={entities:[originalEntity,e2],deletedEntityIds:new Set(),entityMappings:new Map(),groupMappings:[],
        previewViewBox:frame,backgroundColor:'#000000',background:settings};
      const plans=[await planApi.buildCadImportWidgetItemsAsync(base),
        await planApi.buildCadImportWidgetItemsAsync({...base,groupMappings:[{id:'g',entityIds:['pump','second'],widgetInfo:null}]}),
        await planApi.buildCadImportWidgetItemsAsync({...base,outputMode:'background'})];
      return plans.map(items=>({count:items.length,assets:items.map(item=> {
        const saved=JSON.parse(JSON.stringify({settings:{scadaSymbolContent:svgApi.decodeCadSvg(item.entity.svgBase64)}}));
        const svg=new DOMParser().parseFromString(saved.settings.scadaSymbolContent,'image/svg+xml');
        return {background:svg.querySelectorAll('[data-cad-background]').length,
          dark:[...svg.querySelectorAll('path')].filter(p=>paintOf(p)==='#30343b').length,
          sources:[...svg.querySelectorAll('[data-cad-entity-id]')].map(p=>p.getAttribute('data-cad-entity-id'))};
      })}));
    }""")
    assert [p['count'] for p in result] == [2, 1, 1]
    for plan in result:
        for asset in plan['assets']:
            assert asset['background'] == 0 and asset['dark'] == len(asset['sources'])
    assert result[1]['assets'][0]['sources'] == result[2]['assets'][0]['sources'] == ['pump', 'second']


def test_switching_back_to_preserve_is_reversible_and_deleted_entities_stay_deleted(page):
    setup_source(page)
    result=page.evaluate("""async () => {
      await svgApi.buildCadSvgSceneAsync([originalEntity],frame,new Set(),{background:settings});
      const kept=await svgApi.buildCadSvgSceneAsync([originalEntity],frame,new Set(),{backgroundColor:'#000000',background:{...settings,mode:'preserve'}});
      const deleted=await svgApi.buildCadSvgSceneAsync([originalEntity],frame,new Set(['pump']),{background:settings});
      return {white:paintOf(kept.querySelector('path')),deleted:deleted.querySelectorAll('path').length};
    }""")
    assert result == {'white':'rgb(255, 255, 255)','deleted':0}


def test_inherited_currentcolor_styles_are_adapted_but_mask_gradient_and_opacity_not_changed(page):
    result=page.evaluate("""() => {
      const e=entity('inherit','red','<g color="white" stroke="currentColor" opacity="0.5"><path d="M 1 1 L 9 9"/></g>' +
        '<path d="M 1 2 L 9 2" style="stroke:white;fill:none" mask="url(#mask)"/>' +
        '<path d="M 2 2 L 4 4" fill="url(#gradient)"/>',
        '<mask id="mask"><rect fill="white" width="100" height="100"/></mask>' +
        '<linearGradient id="gradient"><stop offset="0" stop-color="white"/></linearGradient>');
      const svg=svgApi.buildCadSvgScene([e],frame,new Set(),{background:{mode:'remove',canvasColor:'#ffffff'}});
      return {paths:[...svg.querySelectorAll('path')].map(p=>p.style.stroke || p.getAttribute('stroke')),
        opacity:svg.querySelector('[opacity]').getAttribute('opacity'),mask:svg.querySelector('mask rect').getAttribute('fill'),
        gradient:svg.querySelector('stop').getAttribute('stop-color'),paint:svg.querySelectorAll('path')[2].getAttribute('fill')};
    }""")
    assert result['paths'][:2] == ['#30343b','#30343b']
    assert result['opacity'] == '0.5' and result['mask'] == result['gradient'] == 'white'
    assert result['paint'].startswith('url(#')


def test_dark_destination_adapts_black_instead_of_always_darkening(page):
    result=page.evaluate("""() => {
      const e=entity('dark','black','<path class="C0" d="M 1 1 L 9 9"/>');
      const svg=svgApi.buildCadSvgScene([e],frame,new Set(),{background:{mode:'remove',canvasColor:'#000000'}});
      return svg.querySelector('path').getAttribute('stroke');
    }""")
    assert result == '#f3f4f6'


def test_background_changes_do_not_bypass_svg_validation_or_cancellation(page):
    result=page.evaluate("""async () => {
      const controller=new AbortController();controller.abort();
      let canceled=false,unsafe=false;
      try {await svgApi.buildCadSvgSceneAsync(crossing,frame,new Set(),{signal:controller.signal,background:{mode:'remove',canvasColor:'#ffffff'}});}
      catch(e){canceled=e.name==='AbortError';}
      try {svgApi.buildCadSvgScene([entity('bad','white','<script>alert(1)</script>')],frame,new Set(),{background:{mode:'remove',canvasColor:'#ffffff'}});}
      catch(e){unsafe=true;}
      return {canceled,unsafe};
    }""")
    assert result == {'canceled':True,'unsafe':True}


def test_background_browser_images_and_many_entity_responsiveness(page,tmp_path):
    setup_source(page)
    folder=Path(os.environ.get('CAD_TEST_ARTIFACTS',str(tmp_path)));folder.mkdir(parents=True,exist_ok=True)
    for mode,color in [('preserve','#000000'),('remove','#ffffff')]:
        page.evaluate("""([mode,color]) => {
          document.body.style.background=color;
          show(svgApi.buildCadSvgScene([originalEntity],frame,new Set(),{backgroundColor:'#000000',background:{mode,canvasColor:color}}));
        }""",[mode,color])
        page.locator('#scene').screenshot(path=str(folder/f'cad-background-{mode}.png'))
    report=page.evaluate("""async () => {
      let ticks=0;const timer=setInterval(()=>ticks++,0),start=performance.now();
      try {
        const svg=await svgApi.buildCadSvgSceneAsync(Array.from({length:1200},(_,i)=>({...originalEntity,id:'p'+i})),frame,new Set(),{background:settings});
        return {entities:svg.querySelectorAll('[data-cad-entity-id]').length,milliseconds:performance.now()-start,ticks};
      } finally {clearInterval(timer);}
    }""")
    assert report['entities']==1200 and report['ticks']>0
    (folder/'cad-background-performance.json').write_text(json.dumps(report,indent=2))
