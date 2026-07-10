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
  buildPreviewCssTransform,
  screenPointToPreviewSvgCoords,
  rectContains,
  shouldIgnoreEntityClickAfterDrag
} from './cad-import-geometry';

assert.equal(
  buildPreviewCssTransform(2, 30, 40),
  'scale(2) translate(30px, 40px)'
);

assert.deepEqual(
  screenPointToPreviewSvgCoords(
    400,
    300,
    { left: 100, top: 50 },
    1,
    0,
    0,
    {
      x: 1000,
      y: 2000,
      width: 1200,
      height: 300
    },
    1200,
    700
  ),
  {
    x: 1300,
    y: 2050
  }
);

const selection = { x: 10, y: 20, width: 40, height: 30 };

assert.equal(rectContains(selection, { x: 20, y: 25, width: 10, height: 15 }), true);
assert.equal(rectContains(selection, { x: 20, y: 25, width: 31, height: 15 }), false);
assert.equal(rectContains(selection, { x: 0, y: 10, width: 60, height: 50 }), false);
assert.equal(rectContains(selection, { x: 20, y: 25, width: 0, height: 15 }), false);

assert.equal(shouldIgnoreEntityClickAfterDrag(true, { width: 6, height: 6 }), true);
assert.equal(shouldIgnoreEntityClickAfterDrag(true, { width: 2, height: 6 }), false);
assert.equal(shouldIgnoreEntityClickAfterDrag(false, { width: 6, height: 6 }), false);
