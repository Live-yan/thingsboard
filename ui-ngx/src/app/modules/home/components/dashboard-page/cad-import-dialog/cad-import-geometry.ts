export interface CadRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CadPoint {
  x: number;
  y: number;
}

export interface CadScreenOrigin {
  left: number;
  top: number;
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

const normalizedZoom = (zoomLevel: number): number =>
  Math.max(finiteOrFallback(zoomLevel, 1), 0.1);

export const buildPreviewCssTransform = (
  zoomLevel: number,
  panX: number,
  panY: number
): string => {
  const zoom = normalizedZoom(zoomLevel);
  const x = finiteOrFallback(panX, 0);
  const y = finiteOrFallback(panY, 0);
  return `scale(${zoom}) translate(${x}px, ${y}px)`;
};

export const screenPointToPreviewViewportCoords = (
  clientX: number,
  clientY: number,
  origin: CadScreenOrigin,
  zoomLevel: number,
  panX: number,
  panY: number
): CadPoint => {
  const zoom = normalizedZoom(zoomLevel);
  return {
    x: (clientX - origin.left) / zoom - finiteOrFallback(panX, 0),
    y: (clientY - origin.top) / zoom - finiteOrFallback(panY, 0)
  };
};

export const previewViewportPointToSvgCoords = (
  point: CadPoint,
  previewTransform: CadPreviewTransform | null | undefined,
  viewportWidth: number,
  viewportHeight: number
): CadPoint => {
  if (!previewTransform) {
    return point;
  }
  const viewWidth = Math.max(finiteOrFallback(viewportWidth, 1), 1);
  const viewHeight = Math.max(finiteOrFallback(viewportHeight, 1), 1);
  const boxWidth = Math.max(finiteOrFallback(previewTransform.width, viewWidth), 1);
  const boxHeight = Math.max(finiteOrFallback(previewTransform.height, viewHeight), 1);
  const scale = Math.min(viewWidth / boxWidth, viewHeight / boxHeight);
  const renderedWidth = boxWidth * scale;
  const renderedHeight = boxHeight * scale;
  const offsetX = (viewWidth - renderedWidth) / 2;
  const offsetY = (viewHeight - renderedHeight) / 2;
  return {
    x: previewTransform.x + (point.x - offsetX) / scale,
    y: previewTransform.y + (point.y - offsetY) / scale
  };
};

export const screenPointToPreviewSvgCoords = (
  clientX: number,
  clientY: number,
  origin: CadScreenOrigin,
  zoomLevel: number,
  panX: number,
  panY: number,
  previewTransform: CadPreviewTransform | null | undefined,
  viewportWidth: number,
  viewportHeight: number
): CadPoint => previewViewportPointToSvgCoords(
  screenPointToPreviewViewportCoords(clientX, clientY, origin, zoomLevel, panX, panY),
  previewTransform,
  viewportWidth,
  viewportHeight
);

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
