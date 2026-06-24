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

import { DashboardLayout, GridSettings, LayoutType, WidgetLayouts } from '@shared/models/dashboard.models';

export interface CadImportGridSettingsResult {
  targetColumns: number;
  cadAspectRatio?: number;
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

const CAD_IMPORT_ROW_HEIGHT_BASE = 50;

export function applyCadImportGridSettings(layout: DashboardLayout, result: CadImportGridSettingsResult): GridSettings {
  layout.gridSettings = layout.gridSettings || {};
  layout.gridSettings.layoutType = LayoutType.scada;
  layout.gridSettings.columns = result.targetColumns;
  layout.gridSettings.margin = 0;
  layout.gridSettings.outerMargin = false;
  layout.gridSettings.autoFillHeight = false;
  const rowHeight = cadImportRowHeight(result.cadAspectRatio);
  if (rowHeight !== undefined) {
    layout.gridSettings.rowHeight = rowHeight;
  }
  return layout.gridSettings;
}

export function syncCadImportLayoutContext(layoutCtx: CadImportLayoutContext, layout: DashboardLayout): void {
  layoutCtx.gridSettings = layout.gridSettings;
  layoutCtx.widgetLayouts = layout.widgets;
  layoutCtx.widgets.setWidgetIds(Object.keys(layout.widgets));
  layoutCtx.ctrl?.reload();
}

function cadImportRowHeight(cadAspectRatio?: number): number | undefined {
  return typeof cadAspectRatio === 'number' && Number.isFinite(cadAspectRatio) && cadAspectRatio > 0
    ? Math.max(1, Math.round(CAD_IMPORT_ROW_HEIGHT_BASE * cadAspectRatio))
    : undefined;
}
