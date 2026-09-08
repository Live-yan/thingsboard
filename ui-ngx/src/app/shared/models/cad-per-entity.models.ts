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

export interface CadPerEntityResult {
  previewSvgBase64: string;
  schemaVersion?: number;
  sceneId?: string;
  sourceEntityCount?: number;
  unrenderedEntityCount?: number;
  skippedPrimitiveCount?: number;
  backgroundColor?: string;
  warnings?: { handle: string; type: string; reason: string }[];
  manifest: CadEntityInfo[];
  modelspaceBounds?: { minX: number; maxX: number; minY: number; maxY: number };
  previewTransform?: PreviewTransform;
}

export interface PreviewTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  translateX: number;
  translateY: number;
  yFlip: boolean;
}

export interface CadEntityInfo {
  id: string;
  type: 'LINE' | 'CIRCLE' | 'ARC' | 'ELLIPSE' | 'SPLINE' | 'LWPOLYLINE' | 'POLYLINE' | 'TEXT' | 'MTEXT' | 'INSERT' | string;
  svgBase64: string;
  x: number;
  y: number;
  width: number;
  height: number;
  blockName?: string | null;
  handle?: string;
  layer?: string;
  previewX?: number;
  previewY?: number;
  previewWidth?: number;
  previewHeight?: number;
}
