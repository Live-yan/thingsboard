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


@pytest.fixture(scope='session')
def compiled(tmp_path_factory):
    output = tmp_path_factory.mktemp('cad-js')
    subprocess.run([
        'tsc', '--strict', '--target', 'es2020', '--module', 'commonjs',
        '--lib', 'es2020,dom', '--outDir', str(output),
        str(CAD / 'cad-import-widget-generation.ts'), str(CAD / 'cad-scene-state.ts'), str(CAD / 'cad-component-groups.ts'),
    ], check=True)
    return output


@pytest.fixture(scope='session')
def browser():
    with sync_playwright() as playwright:
        options = {'headless': True}
        if os.environ.get('CAD_CHROMIUM_EXECUTABLE'):
            options['executable_path'] = os.environ['CAD_CHROMIUM_EXECUTABLE']
        instance = playwright.chromium.launch(**options)
        yield instance
        instance.close()


@pytest.fixture
def page(browser, compiled):
    page = browser.new_page(viewport={'width': 800, 'height': 600})
    page.set_content('<style>body { margin: 0; background: white; } svg { display: block; }</style><div id="scene"></div>')
    page.evaluate('window.cadModules = {}')
    for name in ('cad-import-svg', 'cad-import-grid', 'cad-import-widget-generation', 'cad-scene-state', 'cad-component-groups'):
        source = (compiled / (name + '.js')).read_text(encoding='utf-8')
        page.add_script_tag(content=(
            "cadModules['./" + name + "'] = {};\n"
            "(function(exports, require) {\n" + source + "\n})(cadModules['./" + name
            + "'], name => cadModules[name]);"
        ))
    page.add_script_tag(content=r'''
      window.svgApi = cadModules['./cad-import-svg'];
      window.planApi = cadModules['./cad-import-widget-generation'];
      window.frame = {x: -10, y: -10, width: 120, height: 120};
      window.entity = (id, color, geometry, extra = '') => ({
        id, type: 'LINE', x: 0, y: 0, width: 100, height: 100,
        previewX: 0, previewY: 0, previewWidth: 100, previewHeight: 100,
        svgBase64: svgApi.encodeCadSvg(`<?xml version="1.0" encoding="UTF-8"?>
          <svg xmlns="http://www.w3.org/2000/svg" xmlns:tb="https://thingsboard.io/svg"
               viewBox="0 0 100 100" data-cad-global-entity="true" data-cad-entity-id="${id}">
            <tb:metadata><![CDATA[{"title":"中文设备"}]]></tb:metadata>
            <defs><style>.C0 { fill: none; stroke: ${color}; stroke-width: 4; }</style>${extra}</defs>
            ${geometry}
          </svg>`)
      });
      window.showScene = (entities, deleted = []) => {
        const svg = svgApi.buildCadSvgScene(entities, frame, new Set(deleted));
        svg.setAttribute('width', '480'); svg.setAttribute('height', '480');
        document.getElementById('scene').replaceChildren(svg);
        return svg;
      };
      window.crossing = [
        entity('horizontal', 'red', '<path class="C0" d="M 5 50 L 95 50"/>'),
        entity('vertical', 'blue', '<path class="C0" d="M 50 5 L 50 95"/>')
      ];
      window.items = (entities, deleted = [], mappings = [], groups = []) => planApi.buildCadImportWidgetItems({
        entities, deletedEntityIds: new Set(deleted), entityMappings: new Map(mappings), groupMappings: groups,
        previewViewBox: frame, importMode: 'background'
      });
    ''')
    yield page
    page.close()
