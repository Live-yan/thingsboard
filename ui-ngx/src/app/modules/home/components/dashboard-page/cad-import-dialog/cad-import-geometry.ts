export interface CadRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CadPreviewTransform {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CadSelectionHighlight extends CadRect {
  strokeWidth: number;
  dasharray: string;
  cornerRadius: number;
}

const SELECTION_STROKE_WIDTH = 2;
const SELECTION_DASHARRAY = '6,4';
const SELECTION_CORNER_RADIUS = 2;
const SELECTION_PADDING_PX = 4;

const finiteOrFallback = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;

export const viewBoxUnitsForScreenPixels = (
  previewTransform: CadPreviewTransform | null | undefined,
  viewportWidth: number,
  viewportHeight: number,
  zoomLevel: number,
  pixels: number
): number => {
  const zoom = Math.max(finiteOrFallback(zoomLevel, 1), 0.1);
  if (!previewTransform || previewTransform.width <= 0 || previewTransform.height <= 0) {
    return pixels / zoom;
  }
  const unitsPerPixel = Math.max(
    previewTransform.width / Math.max(viewportWidth, 1),
    previewTransform.height / Math.max(viewportHeight, 1)
  );
  return (unitsPerPixel * pixels) / zoom;
};

export const buildSelectionHighlight = (
  bbox: CadRect,
  previewTransform: CadPreviewTransform | null | undefined,
  viewportWidth: number,
  viewportHeight: number,
  zoomLevel: number
): CadSelectionHighlight => {
  const pad = viewBoxUnitsForScreenPixels(
    previewTransform,
    viewportWidth,
    viewportHeight,
    zoomLevel,
    SELECTION_PADDING_PX
  );
  return {
    x: bbox.x - pad,
    y: bbox.y - pad,
    width: bbox.width + pad * 2,
    height: bbox.height + pad * 2,
    strokeWidth: SELECTION_STROKE_WIDTH,
    dasharray: SELECTION_DASHARRAY,
    cornerRadius: SELECTION_CORNER_RADIUS
  };
};
