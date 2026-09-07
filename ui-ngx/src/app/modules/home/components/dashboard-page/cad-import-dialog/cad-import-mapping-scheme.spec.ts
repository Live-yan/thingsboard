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
import { CadEntityInfo } from '@shared/models/cad-per-entity.models';
import {
  applyCadMappingScheme,
  createCadEntitySignature,
  createCadGroupSignature
} from './cad-import-mapping-scheme';

const svgBase64 = (svg: string): string => btoa(svg);

const line = (id: string, x: number, y: number, width: number, height: number,
              x2: number, y2: number, color = '#000000', strokeWidth = 2): CadEntityInfo => ({
  id,
  type: 'LINE',
  svgBase64: svgBase64(`<svg viewBox="0 0 ${Math.max(width, 1)} ${Math.max(height, 1)}"><line x1="0" y1="0" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${strokeWidth}"/></svg>`),
  x,
  y,
  width,
  height,
  previewX: x,
  previewY: y,
  previewWidth: width,
  previewHeight: height
});

const widgetInfo = { title: 'Pipe', typeFullFqn: 'tenant.pipe', type: 'rpc' } as any;
const groupWidgetInfo = { title: 'Valve', typeFullFqn: 'tenant.valve', type: 'rpc' } as any;

const horizontalShort = line('horizontal-short', 0, 0, 20, 2, 20, 0);
const horizontalLong = line('horizontal-long', 0, 0, 120, 2, 120, 0);
const vertical = line('vertical', 0, 0, 2, 20, 0, 20);
const redHorizontal = line('red-horizontal', 0, 0, 20, 2, 20, 0, '#ff0000');
const thickHorizontal = line('thick-horizontal', 0, 0, 20, 2, 20, 0, '#000000', 4);
const diagonal = line('diagonal', 0, 0, 20, 20, 20, 20);

assert.equal(createCadEntitySignature(horizontalShort), createCadEntitySignature(horizontalLong));
assert.notEqual(createCadEntitySignature(horizontalShort), createCadEntitySignature(vertical));
assert.notEqual(createCadEntitySignature(horizontalShort), createCadEntitySignature(redHorizontal));
assert.notEqual(createCadEntitySignature(horizontalShort), createCadEntitySignature(thickHorizontal));
assert.notEqual(createCadEntitySignature(horizontalShort), createCadEntitySignature(diagonal));
assert.doesNotThrow(() => createCadEntitySignature({
  ...horizontalShort,
  svgBase64: 'not-valid-base64'
}));

const square = [
  line('square-top', 0, 0, 100, 2, 100, 0),
  line('square-right', 98, 0, 2, 100, 0, 100),
  line('square-bottom', 0, 98, 100, 2, 100, 0),
  line('square-left', 0, 0, 2, 100, 0, 100)
];
const largerSquare = [
  line('larger-top', 0, 0, 140, 2, 140, 0),
  line('larger-right', 138, 0, 2, 140, 0, 140),
  line('larger-bottom', 0, 138, 140, 2, 140, 0),
  line('larger-left', 0, 0, 2, 140, 0, 140)
];

const scheme = {
  version: 1,
  name: 'Default CAD scheme',
  updatedAt: 1,
  entityRules: [
    { signature: createCadEntitySignature(horizontalShort), widgetInfo }
  ],
  groupRules: [
    {
      signature: createCadGroupSignature(square),
      memberSignatures: square.map(createCadEntitySignature),
      widgetInfo: groupWidgetInfo
    },
    {
      signature: createCadGroupSignature(square.slice(0, 2)),
      memberSignatures: square.slice(0, 2).map(createCadEntitySignature),
      widgetInfo
    }
  ]
};

const result = applyCadMappingScheme([
  ...largerSquare,
  line('horizontal-long', 300, 300, 120, 2, 120, 0)
], scheme);
assert.equal(result.groupMappings.length, 1);
assert.deepEqual(result.groupMappings[0].entityIds, largerSquare.map(entity => entity.id));
assert.equal(result.groupMappings[0].widgetInfo, groupWidgetInfo);
assert.equal(result.entityMappings.get('horizontal-long'), widgetInfo);
assert.equal(result.entityMappings.has('larger-top'), false);

// Dense drawings must not enter an unbounded all-pairs / combinatorial group search.
const dense = Array.from({ length: 5000 }, (_, index) => ({ ...horizontalShort, id: `dense-${index}` }));
const limited = applyCadMappingScheme(dense, {
  ...scheme,
  groupRules: [{
    signature: createCadGroupSignature(dense.slice(0, 2)),
    memberSignatures: dense.slice(0, 2).map(createCadEntitySignature),
    widgetInfo: groupWidgetInfo
  }]
});
assert.equal(limited.groupMatchingLimited, true);
assert.equal(limited.groupMappings.length, 0);
assert.equal(limited.entityMappings.size, 5000);
