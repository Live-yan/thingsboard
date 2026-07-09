///
/// Copyright © 2016-2026 The Thingsboard Authors
///
/// Licensed under the Apache License, Version 2.0 (the "License");
/// you may not use this file except in compliance with the License.
/// You may obtain a copy of the License at
///
///     http://www.apache.org/licenses/LICENSE-2.0
///
/// Unless required by applicable law or agreed to in writing, software
/// distributed under the License is distributed on an "AS IS" BASIS,
/// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
/// See the License for the specific language governing permissions and
/// limitations under the License.
///

import assert from 'node:assert/strict';
import {
  buildCadImportWidgetItems,
  cadImportWidgetPlan,
  cadMappedScadaWidgetConfigDefaults,
  expandCadGridBounds
} from './cad-import-widget-generation';

assert.deepEqual(
  cadImportWidgetPlan({
    importEntityCount: 500
  }),
  {
    totalWorkItems: 500
  }
);

assert.deepEqual(
  expandCadGridBounds(
    { col: 20, row: 30, sizeX: 1, sizeY: 1 },
    1000,
    700,
    4,
    4
  ),
  { col: 19, row: 29, sizeX: 4, sizeY: 4 }
);

assert.deepEqual(
  expandCadGridBounds(
    { col: 0, row: 0, sizeX: 1, sizeY: 1 },
    1000,
    700,
    4,
    4
  ),
  { col: 0, row: 0, sizeX: 4, sizeY: 4 }
);

assert.deepEqual(
  cadMappedScadaWidgetConfigDefaults({
    title: 'Extra long horizontal pipe',
    type: 'rpc',
    preserveAspectRatio: false
  }),
  {
    title: 'Extra long horizontal pipe',
    showTitle: false,
    dropShadow: false,
    resizable: true,
    preserveAspectRatio: false,
    backgroundColor: 'rgba(0,0,0,0)',
    padding: '0',
    margin: '0',
    targetDevice: {
      type: 'device'
    },
    datasources: [],
    settings: {
      padding: '0',
      background: {
        type: 'color',
        imageUrl: null,
        color: 'rgba(0,0,0,0)',
        overlay: {
          enabled: false,
          color: 'rgba(255,255,255,0.72)',
          blur: 3
        }
      },
      scadaSymbolObjectSettings: {
        behavior: {},
        properties: {},
        stretchToFit: true
      }
    }
  }
);

const groupedWidget = {
  title: 'Pump group',
  type: 'rpc',
  typeFullFqn: 'tenant.pump_group'
};

const widgetItems = buildCadImportWidgetItems({
  entities: [
    {
      id: 'entity-a',
      type: 'LINE',
      svgBase64: '',
      x: 10,
      y: 20,
      width: 5,
      height: 5,
      previewX: 100,
      previewY: 200,
      previewWidth: 20,
      previewHeight: 20
    },
    {
      id: 'entity-b',
      type: 'LINE',
      svgBase64: '',
      x: 40,
      y: 25,
      width: 10,
      height: 15,
      previewX: 150,
      previewY: 220,
      previewWidth: 30,
      previewHeight: 20
    },
    {
      id: 'entity-c',
      type: 'CIRCLE',
      svgBase64: '',
      x: 90,
      y: 20,
      width: 10,
      height: 10,
      previewX: 260,
      previewY: 200,
      previewWidth: 20,
      previewHeight: 20
    }
  ],
  deletedEntityIds: new Set<string>(),
  entityMappings: new Map<string, any>([
    ['entity-a', { title: 'Ignored individual mapping' }]
  ]),
  groupMappings: [
    {
      id: 'cad-group-1',
      entityIds: ['entity-a', 'entity-b'],
      widgetInfo: groupedWidget
    }
  ]
});

assert.equal(widgetItems.length, 2);
assert.equal(widgetItems[0].id, 'cad-group-1');
assert.deepEqual(widgetItems[0].entityIds, ['entity-a', 'entity-b']);
assert.equal(widgetItems[0].mapping, groupedWidget);
assert.deepEqual(
  {
    x: widgetItems[0].entity.x,
    y: widgetItems[0].entity.y,
    width: widgetItems[0].entity.width,
    height: widgetItems[0].entity.height,
    previewX: widgetItems[0].entity.previewX,
    previewY: widgetItems[0].entity.previewY,
    previewWidth: widgetItems[0].entity.previewWidth,
    previewHeight: widgetItems[0].entity.previewHeight
  },
  {
    x: 10,
    y: 20,
    width: 40,
    height: 20,
    previewX: 100,
    previewY: 200,
    previewWidth: 80,
    previewHeight: 40
  }
);
assert.equal(widgetItems[1].id, 'entity-c');

assert.deepEqual(
  cadMappedScadaWidgetConfigDefaults({
    title: 'CAD LINE entity_67',
    type: 'rpc',
    preserveAspectRatio: true,
    stretchToFit: true,
    scadaSymbolUrl: 'tb-image;/api/images/tenant/CAD LINE entity_67.svg'
  }).settings.scadaSymbolObjectSettings,
  {
    behavior: {},
    properties: {},
    stretchToFit: true
  }
);
