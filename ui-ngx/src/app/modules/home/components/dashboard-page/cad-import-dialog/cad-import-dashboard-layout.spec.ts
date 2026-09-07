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
import type { DashboardLayout, LayoutType } from '@shared/models/dashboard.models';
import { applyCadImportGridSettings, syncCadImportLayoutContext } from './cad-import-dashboard-layout';

const layout: DashboardLayout = {
  widgets: {
    widgetA: { row: 12, col: 34, sizeX: 56, sizeY: 78 },
    widgetB: { row: 90, col: 123, sizeX: 45, sizeY: 67 }
  },
  gridSettings: {
    layoutType: 'default' as LayoutType,
    columns: 24,
    margin: 10,
    outerMargin: true,
    autoFillHeight: true
  }
};

const widgetIds: string[][] = [];
let reloadCount = 0;
const layoutCtx = {
  gridSettings: { ...layout.gridSettings },
  widgetLayouts: {},
  widgets: {
    setWidgetIds(ids: string[]) {
      widgetIds.push(ids);
    }
  },
  ctrl: {
    reload() {
      reloadCount++;
    }
  }
};

applyCadImportGridSettings(layout, {
  targetColumns: 1000,
  cadAspectRatio: 0.7
});
syncCadImportLayoutContext(layoutCtx, layout);

assert.equal(layout.gridSettings.layoutType, 'scada');
assert.equal(layout.gridSettings.columns, 1000);
assert.equal(layout.gridSettings.margin, 0);
assert.equal(layout.gridSettings.outerMargin, false);
assert.equal(layout.gridSettings.autoFillHeight, false);
assert.equal(layout.gridSettings.rowHeight, 35);

assert.equal(layoutCtx.gridSettings, layout.gridSettings);
assert.equal(layoutCtx.widgetLayouts, layout.widgets);
assert.deepEqual(widgetIds, [['widgetA', 'widgetB']]);
assert.equal(reloadCount, 1);
