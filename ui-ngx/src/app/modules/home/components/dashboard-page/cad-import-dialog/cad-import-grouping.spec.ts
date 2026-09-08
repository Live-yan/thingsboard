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
import { cadDragMoved, cadImportWarnings, combineCadSelection, expandCadGroupSelection } from './cad-import-grouping';

const group = { id: 'g1', entityIds: ['a', 'b'], widgetInfo: null };
assert.deepEqual([...expandCadGroupSelection(new Set(['a']), [group])], ['a', 'b']);
const result = combineCadSelection(new Set(['b', 'c']), [group], ['a','b','c','d'], 'g2');
assert.deepEqual(result, [{id:'g2', entityIds:['a','b','c'], widgetInfo:null}]);
assert.deepEqual(group.entityIds, ['a','b']); // no mutation of the original grouping
assert.throws(() => combineCadSelection(new Set(['a']), [], ['a','b'], 'g2'));
assert.throws(() => combineCadSelection(new Set(['a','unknown']), [], ['a','b'], 'g2'));
assert.throws(() => combineCadSelection(new Set(['a','b']), [group], ['a','b'], 'g1'));
assert.equal(cadDragMoved(0,0,0,3), false);
assert.equal(cadDragMoved(0,0,4,0), true);
assert.equal(cadDragMoved(100,100,103,103), true);
const font = {type:'FONT',handle:'A0E3',reason:'romans'};
assert.equal(cadImportWarnings([font,font]).warnings.length, 1);
assert.equal(cadImportWarnings([font]).needsAcknowledgement, false);
assert.equal(cadImportWarnings([{...font,type:'IMAGE'}]).needsAcknowledgement, true);
