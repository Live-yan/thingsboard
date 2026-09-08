/// Copyright © 2016-2026 The Thingsboard Authors
/// Licensed under the Apache License, Version 2.0 (the "License");
/// you may not use this file except in compliance with the License.
/// You may obtain a copy at http://www.apache.org/licenses/LICENSE-2.0
/// Unless required by applicable law or agreed to in writing, software
/// distributed under the License is distributed on an "AS IS" BASIS,
/// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
/// See the License for the specific language governing permissions and
/// limitations under the License.
import assert from 'node:assert/strict';
import { cadCanvasColor } from './cad-import-background';
import { applyCadImportGridSettings } from './cad-import-dashboard-layout';
const layout: any = { gridSettings: { backgroundColor: '#000000', backgroundImageUrl: '/old.png' } };
const settings = { mode: 'remove' as const, canvasColor: '#ffffff' };
applyCadImportGridSettings(layout, { targetColumns: 1000, backgroundColor: cadCanvasColor('#000000', settings) });
assert.equal(layout.gridSettings.backgroundColor, '#ffffff');
assert.equal(layout.gridSettings.backgroundImageUrl, null);
const exported = JSON.parse(JSON.stringify({layout, config: {cadBackground: settings}}));
assert.deepEqual(exported.config.cadBackground, settings);
assert.equal(exported.layout.gridSettings.backgroundColor, '#ffffff');
applyCadImportGridSettings(layout, { targetColumns: 1000, backgroundColor: cadCanvasColor('#000000', { ...settings, mode: 'preserve' }) });
assert.equal(layout.gridSettings.backgroundColor, '#000000');
