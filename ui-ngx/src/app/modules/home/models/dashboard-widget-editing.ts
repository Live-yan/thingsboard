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

import { Widget } from '@app/shared/models/widget.models';
import { WidgetLayout } from '@app/shared/models/dashboard.models';

export const CAD_IMPORT_RESIZE_SUPPRESSION_MAX_SIZE = 24;

export interface DashboardWidgetResizeHandles {
  n: boolean;
  e: boolean;
  s: boolean;
  w: boolean;
  ne: boolean;
  se: boolean;
  sw: boolean;
  nw: boolean;
}

export interface DashboardWidgetResizePolicy {
  resizeEnabled: boolean;
  resizableHandles: DashboardWidgetResizeHandles;
}

const allResizeHandles = (enabled: boolean): DashboardWidgetResizeHandles => ({
  n: enabled,
  e: enabled,
  s: enabled,
  w: enabled,
  ne: enabled,
  se: enabled,
  sw: enabled,
  nw: enabled
});

export const isSmallCadImportWidget = (
  widget: Pick<Widget, 'config' | 'sizeX' | 'sizeY'>,
  layout?: Pick<WidgetLayout, 'sizeX' | 'sizeY'>
): boolean => {
  if (widget.config?.cadImport !== true) {
    return false;
  }
  const sizeX = Number(layout?.sizeX ?? widget.sizeX);
  const sizeY = Number(layout?.sizeY ?? widget.sizeY);
  return Number.isFinite(sizeX) && Number.isFinite(sizeY) &&
    sizeX > 0 && sizeY > 0 &&
    sizeX <= CAD_IMPORT_RESIZE_SUPPRESSION_MAX_SIZE && sizeY <= CAD_IMPORT_RESIZE_SUPPRESSION_MAX_SIZE;
};

export const dashboardWidgetResizePolicy = (
  widget: Pick<Widget, 'config' | 'sizeX' | 'sizeY'>,
  layout?: Pick<WidgetLayout, 'sizeX' | 'sizeY' | 'preserveAspectRatio' | 'resizable'>
): DashboardWidgetResizePolicy => {
  if (isSmallCadImportWidget(widget, layout)) {
    return {
      resizeEnabled: false,
      resizableHandles: allResizeHandles(false)
    };
  }

  const handles = allResizeHandles(true);
  if (layout?.preserveAspectRatio) {
    handles.ne = false;
    handles.sw = false;
    handles.nw = false;
  }
  return {
    resizeEnabled: true,
    resizableHandles: handles
  };
};
