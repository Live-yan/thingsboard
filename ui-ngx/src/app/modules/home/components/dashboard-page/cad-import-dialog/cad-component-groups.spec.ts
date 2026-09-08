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
import { combineCadSelection, expandCadGroupSelection, cadComponentSnapshot, restoreCadComponentSnapshot } from './cad-component-groups';
const source = ['a', 'b', 'c', 'd'];
const first = combineCadSelection(source, [], ['a', 'b'], 'g1');
assert.deepEqual(first.groups, [{ id: 'g1', entityIds: ['a', 'b'], widgetInfo: null }]);
assert.deepEqual([...expandCadGroupSelection(['a'], first.groups)], ['a', 'b']);
const second = combineCadSelection(source, first.groups, ['b', 'c'], 'g2');
assert.deepEqual(second.groups, [{ id: 'g2', entityIds: ['a', 'b', 'c'], widgetInfo: null }]);
assert.equal(first.groups.length, 1); // operations do not mutate prior snapshots
assert.throws(() => combineCadSelection(source, first.groups, ['missing', 'c'], 'g2'));
assert.throws(() => combineCadSelection(source, first.groups, ['a', 'b'], 'a'));
const snapshot = cadComponentSnapshot('file-hash', second.groups, 'components');
assert.deepEqual(restoreCadComponentSnapshot(JSON.parse(JSON.stringify(snapshot)), 'file-hash', source), snapshot);
assert.throws(() => restoreCadComponentSnapshot(snapshot, 'other-source', source));
assert.throws(() => restoreCadComponentSnapshot(snapshot, 'file-hash', ['a', 'c']));
assert.throws(() => restoreCadComponentSnapshot({ ...snapshot, groups: [...snapshot.groups, {id: 'g3', entityIds: ['b', 'd']}] }, 'file-hash', source));
assert.throws(() => restoreCadComponentSnapshot({ ...snapshot, groups: [{id: 'g3', entityIds: ['b', 'b']}] }, 'file-hash', source));
assert.throws(() => restoreCadComponentSnapshot({ ...snapshot, version: 2 }, 'file-hash', source));
