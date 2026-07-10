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
