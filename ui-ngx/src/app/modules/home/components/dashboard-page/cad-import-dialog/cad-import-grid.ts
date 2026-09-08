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

import { CadSvgBounds, validateCadSvgBounds } from './cad-import-svg';

export interface CadGridFrame {
  columns: number;
  rows: number;
  scale: number;
  viewBox: CadSvgBounds;
}

/** Square Gridster cells; neither dimension may exceed maxItemCols/Rows (1000).
 * Pad by less than one cell rather than independently stretching the two axes.
 */
export function cadGridFrame(frame: CadSvgBounds): CadGridFrame {
  validateCadSvgBounds(frame);
  const scale = 1000 / Math.max(frame.width, frame.height);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('CAD scene scale is out of range');
  const columns = Math.max(1, Math.ceil(frame.width * scale - 1e-9));
  const rows = Math.max(1, Math.ceil(frame.height * scale - 1e-9));
  return { columns, rows, scale, viewBox: {
    x: frame.x, y: frame.y, width: columns / scale, height: rows / scale
  } };
}

export function cadBoundsToGrid(bounds: CadSvgBounds, frame: CadGridFrame): { col: number; row: number; sizeX: number; sizeY: number } {
  validateCadSvgBounds(bounds);
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max));
  const col = clamp(Math.floor((bounds.x - frame.viewBox.x) * frame.scale + 1e-9), 0, frame.columns - 1);
  const row = clamp(Math.floor((bounds.y - frame.viewBox.y) * frame.scale + 1e-9), 0, frame.rows - 1);
  const endCol = clamp(Math.ceil((bounds.x + bounds.width - frame.viewBox.x) * frame.scale - 1e-9), col + 1, frame.columns);
  const endRow = clamp(Math.ceil((bounds.y + bounds.height - frame.viewBox.y) * frame.scale - 1e-9), row + 1, frame.rows);
  return { col, row, sizeX: endCol - col, sizeY: endRow - row };
}

/** Keep the drawing's scale even when tiny components need larger edit handles.
 * The SVG viewport is expanded to the SAME integer cell edges as the widget;
 * only transparent padding grows, never the original geometry.
 */
export function cadComponentFrame(bounds: CadSvgBounds, frame: CadGridFrame) {
  const grid = cadBoundsToGrid(bounds, frame);
  const sizeX = Math.min(frame.columns, Math.max(grid.sizeX, 4));
  const sizeY = Math.min(frame.rows, Math.max(grid.sizeY, 4));
  const col = Math.max(0, Math.min(Math.floor(grid.col - (sizeX - grid.sizeX) / 2), frame.columns - sizeX));
  const row = Math.max(0, Math.min(Math.floor(grid.row - (sizeY - grid.sizeY) / 2), frame.rows - sizeY));
  return { col, row, sizeX, sizeY, viewBox: {
    x: frame.viewBox.x + col / frame.scale,
    y: frame.viewBox.y + row / frame.scale,
    width: sizeX / frame.scale, height: sizeY / frame.scale
  } };
}
