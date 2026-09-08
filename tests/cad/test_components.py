# Copyright © 2016-2026 The Thingsboard Authors
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy at http://www.apache.org/licenses/LICENSE-2.0
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""Editable output is the default; original background tests remain explicit.

These execute production planner/SVG/selection functions in Chromium, not a live
ThingsBoard HTTP server. The app and templates are compiled separately in CI.
"""
import json
import os
from pathlib import Path


def test_default_output_is_separate_editable_scada_content(page):
    result = page.evaluate('''async () => {
      const output = await planApi.buildCadImportWidgetItemsAsync({
        entities: crossing, deletedEntityIds: new Set(), entityMappings: new Map(), groupMappings: [], previewViewBox: frame
      });
      const config = output.map(item => ({
        id: item.id, entityIds: item.entityIds, config: planApi.cadMappedScadaWidgetConfigDefaults({
          title: item.id, type: 'rpc', preserveAspectRatio: true, scadaSymbolContent: svgApi.decodeCadSvg(item.entity.svgBase64)
        })
      }));
      const restored = JSON.parse(JSON.stringify(config));
      return {ids: restored.map(item => item.id), members: restored.map(item => item.entityIds),
              inline: restored.every(item => item.config.settings.scadaSymbolContent.includes('<path')),
              urls: restored.map(item => item.config.settings.scadaSymbolUrl)};
    }''')
    assert result == {'ids': ['horizontal', 'vertical'], 'members': [['horizontal'], ['vertical']],
                      'inline': True, 'urls': [None, None]}


def test_raw_group_needs_no_mapping_and_survives_json_export(page):
    result = page.evaluate('''async () => {
      const entities = [...crossing, entity('third', 'green', '<path class="C0" d="M 20 20 L 30 30"/>')];
      const groups = cadModules['./cad-import-grouping'].combineCadSelection(new Set(['vertical','horizontal']), [], entities.map(e => e.id), 'pump');
      const output = await planApi.buildCadImportWidgetItemsAsync({
        entities, groupMappings: groups, deletedEntityIds: new Set(), entityMappings: new Map(), previewViewBox: frame
      });
      const group = output[0];
      const saved = JSON.parse(JSON.stringify(output));
      const svg = new DOMParser().parseFromString(svgApi.decodeCadSvg(saved[0].entity.svgBase64), 'image/svg+xml');
      return {ids: saved.map(i => i.id), members: group.entityIds, mapping: group.mapping,
              paths: svg.querySelectorAll('path').length,
              background: svg.querySelectorAll('[data-cad-background]').length};
    }''')
    assert result == {'ids': ['pump', 'third'], 'members': ['horizontal', 'vertical'], 'mapping': None, 'paths': 2, 'background': 0}


def test_mapped_groups_and_unmapped_instances_can_coexist(page):
    result = page.evaluate('''() => {
      const entities = [...crossing, entity('third', 'green', '<circle cx="30" cy="30" r="10"/>')];
      const mapping = {title: 'Live pump', typeFullFqn:'tenant.pump'};
      const output = planApi.buildCadImportWidgetItems({entities, previewViewBox: frame,
        deletedEntityIds:new Set(), entityMappings:new Map(),
        groupMappings:[{id:'pump',entityIds:['horizontal','vertical'],widgetInfo:mapping}]});
      return {count:output.length, mapped:output[0].mapping.title, raw:!!output[1].entity.svgBase64,
              members:output.flatMap(item => item.entityIds)};
    }''')
    assert result == {'count': 2, 'mapped': 'Live pump', 'raw': True, 'members': ['horizontal','vertical','third']}


def test_independent_render_matches_whole_scene_without_opaque_overlap(page):
    page.evaluate('''() => {
      window.geometry = [
        entity('thin', 'red', '<path class="C0" d="M 5 50.15 L 95 50.15"/>'),
        entity('circle', 'blue', '<circle class="C0" cx="50.25" cy="50.15" r="0.25"/>')
      ];
      geometry[1].previewX = 47.5; geometry[1].previewY = 47.5;
      geometry[1].previewWidth = 5.5; geometry[1].previewHeight = 5.5;
      showScene(geometry);
    }''')
    before = page.locator('#scene').screenshot()
    page.evaluate('''async () => {
      const output = await planApi.buildCadImportWidgetItemsAsync({entities:geometry, previewViewBox:frame,
        deletedEntityIds:new Set(),entityMappings:new Map(),groupMappings:[]});
      showScene(output.map(item => item.entity));
    }''')
    after = page.locator('#scene').screenshot()
    assert after == before


def test_delete_group_member_cannot_resurrect_in_export(page):
    result = page.evaluate('''async () => {
      const output = await planApi.buildCadImportWidgetItemsAsync({entities:crossing, previewViewBox:frame,
        deletedEntityIds:new Set(['horizontal']),entityMappings:new Map(),
        groupMappings:[{id:'pump',entityIds:['horizontal','vertical'],widgetInfo:null}]});
      return output.map(item => ({id:item.id,members:item.entityIds,
        deletedPresent:svgApi.decodeCadSvg(item.entity.svgBase64).includes('data-cad-entity-id="horizontal"')}));
    }''')
    assert result == [{'id':'vertical','members':['vertical'],'deletedPresent':False}]


def test_bulk_components_yield_without_one_timer_per_entity(page, tmp_path):
    result = page.evaluate('''async () => {
      const entities = Array.from({length:1200}, (_,i) => entity('line-'+i, 'red','<path class="C0" d="M 5 50 L 95 50"/>'));
      let beats=0; const heartbeat=setInterval(() => beats++,0); const start=performance.now();
      const output=await planApi.buildCadImportWidgetItemsAsync({entities,previewViewBox:frame,
        deletedEntityIds:new Set(),entityMappings:new Map(),groupMappings:[]});
      clearInterval(heartbeat);
      return {widgets:output.length,heartbeat:beats,milliseconds:performance.now()-start,
              inline:output.every(item => !!item.entity.svgBase64)};
    }''')
    assert result['widgets'] == 1200 and result['inline'] and result['heartbeat'] > 0
    # Do not use a fragile fixed wall-clock SLA on shared CI runners.
    artifacts = Path(os.environ.get('CAD_TEST_ARTIFACTS', str(tmp_path)))
    artifacts.mkdir(parents=True, exist_ok=True)
    (artifacts / 'independent-components-performance.json').write_text(json.dumps(result, indent=2))


def test_cancel_component_preparation_returns_no_partial_output(page):
    result=page.evaluate('''async () => {
      const controller=new AbortController();
      const entities=Array.from({length:100}, (_,i) => entity('line-'+i,'red','<path class="C0" d="M 5 50 L 95 50"/>'));
      setTimeout(() => controller.abort(),0);
      try { await planApi.buildCadImportWidgetItemsAsync({entities,previewViewBox:frame,deletedEntityIds:new Set(),
        entityMappings:new Map(),groupMappings:[]},{signal:controller.signal}); return 'unexpected'; }
      catch(error){ return error.name; }
    }''')
    assert result == 'AbortError'


def test_font_only_warnings_do_not_gate_scada_but_missing_images_do(page):
    result=page.evaluate('''() => {
      const api=cadModules['./cad-import-grouping'];
      const warning={type:'FONT',handle:'A0E3',reason:'romans unavailable'};
      const fonts=api.cadImportWarnings([warning,warning]);
      const images=api.cadImportWarnings([warning,{type:'IMAGE',handle:'B',reason:'missing external image'}]);
      const big=api.cadImportWarnings([{type:'BIGFONT',handle:'C',reason:'unsupported composition'}]);
      return {count:fonts.warnings.length, fontAck:fonts.needsAcknowledgement,
              imageAck:images.needsAcknowledgement,bigfontAck:big.needsAcknowledgement};
    }''')
    assert result == {'count':1,'fontAck':False,'imageAck':True,'bigfontAck':True}
