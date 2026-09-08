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
import { cadCanvasColor, cadReadablePaint } from './cad-import-background';
assert.equal(cadCanvasColor('#000000'), '#000000');
assert.equal(cadCanvasColor('#000000', { mode: 'remove', canvasColor: '#ffffff' }), '#ffffff');
assert.equal(cadCanvasColor('#000000', { mode: 'preserve', canvasColor: '#ffffff' }), '#000000');
assert.equal(cadReadablePaint('#ffffff', '#ffffff'), '#30343b');
assert.equal(cadReadablePaint('white', '#ffffff'), '#30343b');
assert.equal(cadReadablePaint('rgb(255, 255, 255)', '#ffffff'), '#30343b');
assert.equal(cadReadablePaint('#000000', '#000000'), '#f3f4f6');
assert.equal(cadReadablePaint('#ff0000', '#ffffff'), '#ff0000');
assert.equal(cadReadablePaint('#0000ff', '#ffffff'), '#0000ff');
assert.equal(cadReadablePaint('#fff', '#000000'), '#fff');
assert.equal(cadReadablePaint('none', '#ffffff'), 'none');
assert.equal(cadReadablePaint('rgba(255,255,255,0.2)', '#ffffff'), 'rgba(255,255,255,0.2)');
assert.equal(cadReadablePaint('url(#gradient)', '#ffffff'), 'url(#gradient)');
assert.throws(() => cadCanvasColor('#000000', { mode: 'remove', canvasColor: 'transparent' }));
assert.throws(() => cadCanvasColor('#000000', { mode: 'invalid' as any, canvasColor: '#fff000' }));
const yellow = cadReadablePaint('#ffff00', '#ffffff');
assert.notEqual(yellow, '#ffff00');
assert.equal(yellow.slice(1, 3), yellow.slice(3, 5)); // Same hue; never blanket invert to blue.
assert.equal(yellow.slice(5, 7), '00');
assert.equal(cadReadablePaint(yellow, '#ffffff'), yellow); // Already-adapted resources are stable.
