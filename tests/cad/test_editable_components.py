# Copyright © 2016-2026 The Thingsboard Authors
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy at http://www.apache.org/licenses/LICENSE-2.0
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""Production component planner, scene and snapshot tests in Chromium.

CAD_REAL_MANIFEST is provided by the real-DWG workflow. The ordinary suite uses
an explicitly synthetic DXF when it is absent; neither replaces deployed E2E.
"""
import json
import os
import sys
import time
from pathlib import Path

import ezdxf
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'application/src/main/data/scripts/cad'))
from cad_scene import convert_scene


def test_default_produces_independent_scada_even_with_preview_frame(page):
    result = page.evaluate('''async () => {
      const input = {entities:crossing,deletedEntityIds:new Set(),entityMappings:new Map(),groupMappings:[],previewViewBox:frame};
      const items = await planApi.buildCadImportWidgetItemsAsync(input);
      return items.map(item => {
        const root = new DOMParser().parseFromString(svgApi.decodeCadSvg(item.entity.svgBase64),'image/svg+xml');
        return {id:item.id,members:item.entityIds,mapping:item.mapping,
          paths:root.querySelectorAll('path').length, background:root.querySelectorAll('[data-cad-background]').length};
      });
    }''')
    assert result == [{'id': key, 'members': [key], 'mapping': None, 'paths': 1, 'background': 0}
                      for key in ('horizontal', 'vertical')]


def test_unmapped_group_is_real_geometry_not_an_empty_mapping_placeholder(page):
    result = page.evaluate('''async () => {
      const c=entity('extra','green','<circle cx="50" cy="50" r="10"/>');
      const output=await planApi.buildCadImportWidgetItemsAsync({entities:[...crossing,c],deletedEntityIds:new Set(),
        entityMappings:new Map(),groupMappings:[{id:'g',entityIds:['vertical','horizontal'],widgetInfo:null}],previewViewBox:frame});
      return {count:output.length,ids:output.map(i=>i.entityIds),mapped:output[0].mapping,
        paths:new DOMParser().parseFromString(svgApi.decodeCadSvg(output[0].entity.svgBase64),'image/svg+xml').querySelectorAll('path').length};
    }''')
    assert result == {'count': 2, 'ids': [['horizontal', 'vertical'], ['extra']], 'mapped': None, 'paths': 2}


def test_mapping_is_optional_and_does_not_absorb_neighbor(page):
    result = page.evaluate('''async () => {
      const mapped={title:'Pump',typeFullFqn:'tenant.pump'};
      const input={entities:crossing,deletedEntityIds:new Set(),entityMappings:new Map([['horizontal',mapped]]),groupMappings:[],previewViewBox:frame};
      const output=await planApi.buildCadImportWidgetItemsAsync(input);
      return {count:output.length,mapping:output[0].mapping.title,retained:output[1].entityIds,
        paths:new DOMParser().parseFromString(svgApi.decodeCadSvg(output[1].entity.svgBase64),'image/svg+xml').querySelectorAll('path').length};
    }''')
    assert result == {'count': 2, 'mapping': 'Pump', 'retained': ['vertical'], 'paths': 1}


def test_minimum_widget_size_pads_without_stretching_or_shifting_tiny_geometry(page):
    measured = page.evaluate('''async () => {
      const sceneFrame={x:0,y:0,width:1000,height:1000};
      const e={id:'tiny',type:'CIRCLE',x:0,y:0,width:.2,height:.2,previewX:100.1,previewY:201.2,previewWidth:.2,previewHeight:.2,
        svgBase64:svgApi.encodeCadSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 .2 .2" data-cad-local-entity="true"><circle cx=".1" cy=".1" r=".1"/></svg>')};
      const [item]=await planApi.buildCadImportWidgetItemsAsync({entities:[e],deletedEntityIds:new Set(),entityMappings:new Map(),groupMappings:[],previewViewBox:sceneFrame});
      const g=cadModules['./cad-import-grid'];const grid=g.cadBoundsToGrid({x:item.entity.previewX,y:item.entity.previewY,width:item.entity.previewWidth,height:item.entity.previewHeight},g.cadGridFrame(sceneFrame));
      const root=new DOMParser().parseFromString(svgApi.decodeCadSvg(item.entity.svgBase64),'image/svg+xml').documentElement;
      Object.assign(root.style,{position:'absolute',left:grid.col+'px',top:grid.row+'px',width:grid.sizeX+'px',height:grid.sizeY+'px'});
      document.getElementById('scene').replaceChildren(root);
      const b=root.querySelector('circle').getBoundingClientRect();return {left:b.left,top:b.top,width:b.width,height:b.height,grid};
    }''')
    assert measured['grid']['sizeX'] == measured['grid']['sizeY'] == 4
    assert measured['left'] == pytest.approx(100.1, abs=.001)
    assert measured['top'] == pytest.approx(201.2, abs=.001)
    assert measured['width'] == measured['height'] == pytest.approx(.2, abs=.001)


def test_group_save_reload_ungroup_and_deleted_instances_remain_consistent(page):
    result = page.evaluate('''async () => {
      const api=cadModules['./cad-component-groups'];
      const c=entity('deleted','green','<circle cx="50" cy="50" r="10"/>');
      const source=[...crossing,c];
      const grouped=api.combineCadSelection(source.map(e=>e.id),[],['horizontal','vertical'],'g');
      const saved=JSON.parse(JSON.stringify(api.cadComponentSnapshot('same-file',grouped.groups,'components')));
      const restored=api.restoreCadComponentSnapshot(saved,'same-file',source.map(e=>e.id));
      const input={entities:source,deletedEntityIds:new Set(['deleted']),entityMappings:new Map(),
        groupMappings:restored.groups.map(g=>({...g,widgetInfo:null})),previewViewBox:frame};
      const combined=await planApi.buildCadImportWidgetItemsAsync(input);
      const separate=await planApi.buildCadImportWidgetItemsAsync({...input,groupMappings:[]});
      return {combined:combined.map(i=>i.entityIds),separate:separate.map(i=>i.entityIds),
        wholeGroup:[...api.expandCadGroupSelection(['horizontal'],input.groupMappings)]};
    }''')
    assert result == {'combined': [['horizontal', 'vertical']], 'separate': [['horizontal'], ['vertical']],
                      'wholeGroup': ['horizontal', 'vertical']}


def test_component_export_abort_is_atomic(page):
    assert page.evaluate('''async () => {
      const cancel=new AbortController();
      try { await planApi.buildCadImportWidgetItemsAsync({entities:crossing,deletedEntityIds:new Set(),entityMappings:new Map(),
        groupMappings:[],previewViewBox:frame},{signal:cancel.signal,onProgress:()=>cancel.abort()});return false; }
      catch(e){return e.name==='AbortError';}
    }''')


def test_converted_fixture_can_be_individually_edited_and_combined(page, tmp_path):
    actual = os.environ.get('CAD_REAL_MANIFEST')
    if actual:
        path = Path(actual)
    else:
        doc = ezdxf.new(); block = doc.blocks.new('PUMP'); block.add_circle((0,0),3)
        for i in range(73): doc.modelspace().add_blockref('PUMP',(i*10, i%3*10))
        source = tmp_path / 'synthetic.dxf'; doc.saveas(source)
        convert_scene(source, tmp_path / 'converted', web_bundle=True)
        path = tmp_path / 'converted/manifest.json'
    manifest = json.loads(path.read_text())
    assert manifest['totalCount'] == 73
    started = time.perf_counter()
    result = page.evaluate('''async data => {
      const input={entities:data.entities,deletedEntityIds:new Set(),entityMappings:new Map(),groupMappings:[],previewViewBox:data.previewViewBox};
      const independent=await planApi.buildCadImportWidgetItemsAsync(input);
      const selection=data.entities.slice(0,5).map(e=>e.id);
      const grouped=await planApi.buildCadImportWidgetItemsAsync({...input,groupMappings:[{id:'selection',entityIds:selection,widgetInfo:null}]});
      const restored=JSON.parse(JSON.stringify(grouped));
      const groups=restored.filter(i=>i.id==='selection');
      for(const item of restored){
        const root=new DOMParser().parseFromString(svgApi.decodeCadSvg(item.entity.svgBase64),'image/svg+xml');
        if(root.querySelector('parsererror')||root.querySelector('[data-cad-background]')) throw Error('Invalid component artwork');
        if([...root.querySelectorAll('g[data-cad-entity-id]')].map(n=>n.getAttribute('data-cad-entity-id')).sort().join()!==[...item.entityIds].sort().join()) throw Error('Ownership changed');
      }
      return {independent:independent.length,afterGroupingFive:restored.length,
        groupMembers:groups[0].entityIds.length,uniqueMembers:new Set(restored.flatMap(i=>i.entityIds)).size};
    }''', manifest)
    assert result == {'independent': 73, 'afterGroupingFive': 69, 'groupMembers': 5, 'uniqueMembers': 73}
    report = {**result, 'elapsedMs': (time.perf_counter()-started)*1000,
              'source': 'testfile.dwg via test-only LibreDWG' if actual else 'synthetic DXF',
              'scope': 'production planner/serialization in Chromium; not deployed ThingsBoard E2E'}
    artifacts = Path(os.environ.get('CAD_TEST_ARTIFACTS', str(tmp_path)))
    artifacts.mkdir(parents=True, exist_ok=True)
    (artifacts/'editable-components.json').write_text(json.dumps(report, indent=2))
