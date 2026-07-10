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
  CAD_IMPORT_RESIZE_SUPPRESSION_MAX_SIZE,
  dashboardWidgetResizePolicy,
  isSmallCadImportWidget
} from './dashboard-widget-editing';

const ordinaryWidget = { config: {} } as any;
const cadWidget = { config: { cadImport: true } } as any;

assert.equal(CAD_IMPORT_RESIZE_SUPPRESSION_MAX_SIZE, 24);
assert.equal(isSmallCadImportWidget(cadWidget, { sizeX: 24, sizeY: 24 }), true);
assert.equal(isSmallCadImportWidget(cadWidget, { sizeX: 25, sizeY: 24 }), false);
assert.equal(isSmallCadImportWidget(ordinaryWidget, { sizeX: 10, sizeY: 10 }), false);

assert.deepEqual(
  dashboardWidgetResizePolicy(cadWidget, { sizeX: 10, sizeY: 10, preserveAspectRatio: true }),
  {
    resizeEnabled: false,
    resizableHandles: { n: false, e: false, s: false, w: false, ne: false, se: false, sw: false, nw: false }
  }
);

const preservedPolicy = dashboardWidgetResizePolicy(ordinaryWidget, {
  sizeX: 100,
  sizeY: 100,
  preserveAspectRatio: true
});
assert.equal(preservedPolicy.resizeEnabled, true);
assert.deepEqual(preservedPolicy.resizableHandles, {
  n: true,
  e: true,
  s: true,
  w: true,
  ne: false,
  se: true,
  sw: false,
  nw: false
});

assert.deepEqual(
  dashboardWidgetResizePolicy(ordinaryWidget, { sizeX: 100, sizeY: 100, preserveAspectRatio: false }).resizableHandles,
  { n: true, e: true, s: true, w: true, ne: true, se: true, sw: true, nw: true }
);
