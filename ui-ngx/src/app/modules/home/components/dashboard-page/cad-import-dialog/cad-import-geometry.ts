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

const MIN_SELECTION_DRAG_SIZE = 5;

export const rectContains = (container: CadRect, candidate: CadRect): boolean => {
  if (![container.x, container.y, container.width, container.height,
    candidate.x, candidate.y, candidate.width, candidate.height].every(Number.isFinite) ||
      container.width <= 0 || container.height <= 0 || candidate.width <= 0 || candidate.height <= 0) {
    return false;
  }
  const containerX = Math.min(container.x, container.x + container.width);
  const containerY = Math.min(container.y, container.y + container.height);
  const containerRight = Math.max(container.x, container.x + container.width);
  const containerBottom = Math.max(container.y, container.y + container.height);
  return candidate.x >= containerX && candidate.y >= containerY &&
    candidate.x + candidate.width <= containerRight &&
    candidate.y + candidate.height <= containerBottom;
};

export const shouldIgnoreEntityClickAfterDrag = (
  selectionMoved: boolean,
  selectionSize: Pick<CadRect, 'width' | 'height'>
): boolean => selectionMoved &&
  Number.isFinite(selectionSize.width) && Number.isFinite(selectionSize.height) &&
  selectionSize.width > MIN_SELECTION_DRAG_SIZE && selectionSize.height > MIN_SELECTION_DRAG_SIZE;

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
