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
import { cadBoundsToGrid, cadGridFrame } from './cad-import-grid';

for (const [width, height] of [[100, 500], [500, 100], [100, 100], [123.45, 234.56], [1, 100000]]) {
  const grid = cadGridFrame({x: -13, y: 42, width, height});
  assert.ok(grid.columns >= 1 && grid.columns <= 1000);
  assert.ok(grid.rows >= 1 && grid.rows <= 1000);
  assert.ok(Math.abs(grid.columns / grid.viewBox.width - grid.rows / grid.viewBox.height) < 1e-8);
  assert.deepEqual(cadBoundsToGrid(grid.viewBox, grid), {col: 0, row: 0, sizeX: grid.columns, sizeY: grid.rows});
  const bound = {x: -13 + width * .2, y: 42 + height * .2, width: width * .1, height: height * .1};
  const item = cadBoundsToGrid(bound, grid);
  assert.ok(item.col + item.sizeX <= grid.columns && item.row + item.sizeY <= grid.rows);
  assert.ok(item.col <= (bound.x + 13) * grid.scale + 1e-8);
  assert.ok(item.col + item.sizeX >= (bound.x + bound.width + 13) * grid.scale - 1e-8);
}
assert.deepEqual(cadGridFrame({x:0, y:0, width:100, height:500}), {
  columns:200, rows:1000, scale:2, viewBox:{x:0,y:0,width:100,height:500}
});
assert.throws(() => cadGridFrame({x:0,y:0,width:0,height:1}));
