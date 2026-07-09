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

import { CadRect } from './cad-import-geometry';

export interface CadPreviewMaskBounds {
  previewX?: number;
  previewY?: number;
  previewWidth?: number;
  previewHeight?: number;
}

export const buildDeletedPreviewMask = (entity: CadPreviewMaskBounds): CadRect | null => {
  if (!Number.isFinite(entity.previewX) || !Number.isFinite(entity.previewY) ||
      !Number.isFinite(entity.previewWidth) || !Number.isFinite(entity.previewHeight) ||
      entity.previewWidth! <= 0 || entity.previewHeight! <= 0) {
    return null;
  }
  return {
    x: entity.previewX!,
    y: entity.previewY!,
    width: entity.previewWidth!,
    height: entity.previewHeight!
  };
};
