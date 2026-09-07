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
import { CadSceneState } from './cad-scene-state';

const entities = [
  { id: 'cad-10', blockName: 'PUMP' },
  { id: 'cad-11', blockName: 'PUMP' },
  { id: 'cad-12', blockName: 'VALVE' }
];
const scene = new CadSceneState('a'.repeat(64), entities);
scene.deleteInstances(['cad-10', 'cad-10']);
assert.deepEqual(scene.keptEntities.map(entity => entity.id), ['cad-11', 'cad-12']);
assert.equal(entities.length, 3);
assert.throws(() => scene.deleteInstances(['cad-11', 'missing']));
assert.equal(scene.deletedEntityIds.has('cad-11'), false);
const serialized = JSON.stringify(scene.snapshot());
const reopened = new CadSceneState('a'.repeat(64), entities);
reopened.restore(JSON.parse(serialized));
assert.deepEqual(reopened.keptEntities, scene.keptEntities);
assert.throws(() => reopened.restore({ ...scene.snapshot(), sceneId: 'b'.repeat(64) }));
assert.throws(() => reopened.restore({ ...scene.snapshot(), deletedEntityIds: ['cad-10', 'cad-10'] }));
assert.throws(() => reopened.restore({ ...scene.snapshot(), version: 2 }));
assert.deepEqual(reopened.keptEntities.map(entity => entity.id), ['cad-11', 'cad-12']);
assert.deepEqual(scene.undoDelete(), ['cad-10']);
assert.equal(scene.keptEntities.length, 3);
scene.deleteInstances(entities.map(entity => entity.id));
assert.equal(scene.keptEntities.length, 0);
assert.equal(scene.snapshot().deletedEntityIds.length, 3);
assert.throws(() => new CadSceneState('a'.repeat(64), [entities[0], entities[0]]));
const large = new CadSceneState('b'.repeat(64), Array.from({length: 50000}, (_, i) => ({id: `cad-${i}`})));
large.deleteInstances(large.entities.slice(0, 25000).map(entity => entity.id));
const restored = new CadSceneState(large.sceneId, large.entities);
restored.restore(JSON.parse(JSON.stringify(large.snapshot())));
assert.equal(restored.keptEntities.length, 25000);
assert.equal(restored.keptEntities, restored.keptEntities); // cached, not copied on every Angular check
