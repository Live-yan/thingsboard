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

import type { DashboardLayout, GridSettings, LayoutType, WidgetLayouts } from '@shared/models/dashboard.models';

export interface CadImportGridSettingsResult {
  targetColumns: number;
  cadAspectRatio?: number;
  backgroundColor?: string;
}

export interface CadImportLayoutContext {
  gridSettings: GridSettings;
  widgetLayouts: WidgetLayouts;
  widgets: {
    setWidgetIds(widgetIds: string[]): void;
  };
  ctrl?: {
    reload(): void;
  };
}

export function applyCadImportGridSettings(layout: DashboardLayout, result: CadImportGridSettingsResult): GridSettings {
  if (!Number.isInteger(result.targetColumns) || result.targetColumns < 1 || result.targetColumns > 1000) {
    throw new Error('Invalid CAD grid column count');
  }
  layout.gridSettings = layout.gridSettings || {};
  layout.gridSettings.layoutType = 'scada' as LayoutType;
  layout.gridSettings.columns = result.targetColumns;
  // A previous SCADA minimum overrides columns in DashboardLayoutComponent.
  layout.gridSettings.minColumns = result.targetColumns;
  if (result.backgroundColor !== undefined) {
    if (!/^#[0-9a-f]{6}$/i.test(result.backgroundColor)) throw new Error('Invalid CAD canvas color');
    layout.gridSettings.backgroundColor = result.backgroundColor;
  }
  layout.gridSettings.margin = 0;
  layout.gridSettings.outerMargin = false;
  layout.gridSettings.autoFillHeight = false;
  // SCADA uses square cells; rowHeight is a mobile/list setting, not a CAD transform.
  return layout.gridSettings;
}

export function syncCadImportLayoutContext(layoutCtx: CadImportLayoutContext, layout: DashboardLayout): void {
  layoutCtx.gridSettings = layout.gridSettings;
  layoutCtx.widgetLayouts = layout.widgets;
  layoutCtx.widgets.setWidgetIds(Object.keys(layout.widgets));
  layoutCtx.ctrl?.reload();
}
